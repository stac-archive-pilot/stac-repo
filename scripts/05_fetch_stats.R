# =============================================================================
# 05_fetch_stats.R
# -----------------------------------------------------------------------------
# Collects usage statistics and writes site/data/stats.json.
#
# Modes
#   (default)        Build stats.json from every available source:
#                      * legacy OSF downloads (config/site.yml lower bounds, or
#                        exact counts from data/osf_legacy_downloads.csv)
#                      * archived GitHub traffic snapshots ($STAC_TRAFFIC_DIR)
#                      * release asset download_count (per-instrument bundles)
#                      * repository stars / forks / watchers / contributors
#                      * Cloudflare Worker counters (/v1/stats/summary)
#                    Every source is optional; missing tokens or network
#                    access only remove that source from the output.
#   --traffic-only   Fetch the 14-day GitHub traffic window once and store it
#                    as $STAC_TRAFFIC_DIR/YYYY-MM-DD.json (daily cron; the
#                    workflow commits it to the `stats` branch).
#   --osf-legacy     One-time: read per-file download counts from the OSF API
#                    (node 4s9p6) into data/osf_legacy_downloads.csv.
#
# Env: GH_TOKEN (traffic needs a token with Administration: read),
#      GITHUB_REPOSITORY (owner/name), STAC_TRAFFIC_DIR, STAC_API_BASE,
#      STAC_PSEUDONYM_SALT.
# =============================================================================

source("scripts/00_helpers.R")
suppressPackageStartupMessages(library(httr2))

args     <- commandArgs(trailingOnly = TRUE)
root     <- stac_root()
site_cfg <- read_yaml(path(root, "config", "site.yml"))
repo_cfg <- site_cfg |> pluck("repo")
repo     <- Sys.getenv("GITHUB_REPOSITORY", str_c(repo_cfg |> pluck("owner"), "/", repo_cfg |> pluck("name")))
token    <- Sys.getenv("GH_TOKEN", Sys.getenv("GITHUB_TOKEN", ""))
traffic_dir <- Sys.getenv("STAC_TRAFFIC_DIR", path(root, "_stats", "data", "traffic"))
api_base <- Sys.getenv("STAC_API_BASE", site_cfg |> pluck("backend", "api_base") %||% "")

# --- HTTP helpers --------------------------------------------------------------

#' GET a GitHub REST endpoint; returns NULL (with a log line) on any failure.
gh_get <- function(endpoint, query = list()) {
  req <- request("https://api.github.com") |>
    req_url_path_append(endpoint) |>
    req_url_query(!!!query) |>
    req_headers(Accept = "application/vnd.github+json", `X-GitHub-Api-Version` = "2022-11-28") |>
    req_user_agent("stac-archive-stats") |>
    req_retry(max_tries = 3) |>
    req_timeout(30)
  if (nzchar(token)) req <- req |> req_auth_bearer_token(token)
  tryCatch(req |> req_perform() |> resp_body_json(), error = function(e) {
    log_step("GitHub {endpoint}: skipped ({conditionMessage(e)})")
    NULL
  })
}

#' GET JSON from any URL; NULL on failure.
json_get <- function(url) {
  tryCatch(
    request(url) |> req_retry(max_tries = 3) |> req_timeout(30) |> req_perform() |> resp_body_json(),
    error = function(e) { log_step("{url}: skipped ({conditionMessage(e)})"); NULL }
  )
}

# --- Mode: --traffic-only --------------------------------------------------------
if ("--traffic-only" %in% args) {
  if (!nzchar(token)) stop("GH_TOKEN with Administration: read is required for the traffic API.")
  snap <- list(
    fetched_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    repo = repo,
    views = gh_get(glue("repos/{repo}/traffic/views"), list(per = "day")),
    clones = gh_get(glue("repos/{repo}/traffic/clones"), list(per = "day")),
    paths = gh_get(glue("repos/{repo}/traffic/popular/paths")),
    referrers = gh_get(glue("repos/{repo}/traffic/popular/referrers"))
  )
  out <- path(traffic_dir, str_c(format(Sys.Date()), ".json"))
  write_site_json(snap, out, pretty = TRUE)
  log_step("Traffic snapshot written: {out}")
  quit(save = "no", status = 0)
}

# --- Mode: --osf-legacy ------------------------------------------------------------
if ("--osf-legacy" %in% args) {
  # Walk the OSF storage tree of node 4s9p6 and read attributes.extra.downloads.
  walk_osf <- function(url, prefix = "") {
    rows <- list()
    next_url <- url
    while (!is.null(next_url)) {
      page <- json_get(next_url)
      if (is.null(page)) break
      for (item in page |> pluck("data")) {
        a <- item |> pluck("attributes")
        p <- str_c(prefix, a |> pluck("name"))
        if (identical(a |> pluck("kind"), "folder")) {
          sub <- item |> pluck("relationships", "files", "links", "related", "href")
          rows <- c(rows, walk_osf(sub, str_c(p, "/")))
        } else {
          rows <- c(rows, list(tibble(osf_path = p, downloads = a |> pluck("extra", "downloads") %||% NA_integer_)))
        }
      }
      next_url <- page |> pluck("links", "next")
      Sys.sleep(0.3)  # be polite to the OSF API
    }
    rows
  }
  legacy <- walk_osf("https://api.osf.io/v2/nodes/4s9p6/files/osfstorage/") |> list_rbind()
  if (nrow(legacy) == 0) stop("OSF API returned no files; nothing written.")
  map_file <- read_csv(path(root, "migration", "osf_path_map.csv"), show_col_types = FALSE)
  out <- legacy |>
    left_join(map_file |> select(osf_path, repo_path), by = "osf_path") |>
    mutate(fetched_at = format(Sys.Date()))
  # The frozen OSF copy keeps being downloaded (the paper links to it), so a
  # monthly workflow refreshes this file on the stats branch.
  out_file <- Sys.getenv("STAC_OSF_LEGACY_FILE", path(root, "data", "osf_legacy_downloads.csv"))
  dir_create(path_dir(out_file))
  write_csv(out, out_file)
  log_step("OSF legacy counts for {nrow(out)} files written to {out_file}.")
  quit(save = "no", status = 0)
}

# --- Default: assemble stats.json ---------------------------------------------------
catalog <- read_json(path(root, "site", "data", "catalog.json"), simplifyVector = FALSE)
ids <- catalog |> pluck("instruments") |> map_chr("id")

# 1. Legacy OSF downloads: exact per-file counts if fetched, else paper lower bounds
legacy_csv <- c(
  Sys.getenv("STAC_OSF_LEGACY_FILE"),
  path(path_dir(path_dir(traffic_dir)), "data", "osf", "osf_legacy_downloads.csv"),  # stats branch checkout
  path(root, "_stats", "data", "osf", "osf_legacy_downloads.csv"),
  path(root, "data", "osf_legacy_downloads.csv")
) |> keep(\(f) nzchar(f) && file_exists(f)) |> head(1)
legacy <- if (length(legacy_csv) == 1) {
  d <- read_csv(legacy_csv, show_col_types = FALSE) |>
    filter(!is.na(repo_path)) |>
    mutate(id = path_file(path_dir(repo_path)))
  list(
    kind = "exact",
    total = d |> pull(downloads) |> sum(na.rm = TRUE),
    by_instrument = d |> summarise(n = sum(downloads, na.rm = TRUE), .by = id) |> deframe() |> as.list(),
    source = "OSF API v2, attributes.extra.downloads",
    fetched_at = if ("fetched_at" %in% names(d)) max(pull(d, fetched_at)) else NA_character_
  )
} else {
  by_acr <- site_cfg |> pluck("legacy", "downloads_by_acronym_min")
  acr_to_id <- catalog |> pluck("instruments") |>
    keep(\(i) !is.null(i |> pluck("acronym"))) |>
    (\(l) set_names(map_chr(l, "id"), map_chr(l, "acronym")))()
  list(
    kind = "lower-bound",
    total = site_cfg |> pluck("legacy", "downloads_total_min"),
    by_instrument = by_acr |> imap(\(n, a) list(id = acr_to_id[[a]] %||% NA_character_, n = n)) |>
      keep(\(x) !is.na(x |> pluck("id"))) |>
      (\(l) set_names(map(l, "n"), map_chr(l, "id")))(),
    source = site_cfg |> pluck("legacy", "source")
  )
}

# 2. Archived GitHub traffic (deduplicate overlapping 14-day windows by date)
traffic_files <- if (dir_exists(traffic_dir)) dir_ls(traffic_dir, glob = "*.json") else character()
traffic <- traffic_files |>
  map(\(f) {
    s <- read_json(f)
    list(views = s |> pluck("views", "views"), clones = s |> pluck("clones", "clones")) |>
      imap(\(rows, kind) rows |>
        map(\(r) tibble(kind = kind, date = str_sub(r |> pluck("timestamp"), 1, 10),
                        count = r |> pluck("count"), uniques = r |> pluck("uniques"))) |>
        list_rbind()) |>
      list_rbind()
  }) |>
  list_rbind()
traffic_daily <- if (nrow(traffic) == 0) list() else traffic |>
  slice_max(count, n = 1, by = c(kind, date), with_ties = FALSE) |>
  arrange(date) |>
  pivot_wider(names_from = kind, values_from = c(count, uniques), values_fill = 0) |>
  transpose()

# 3. Release bundles: asset name "<id>.zip" -> cumulative download_count
releases <- gh_get(glue("repos/{repo}/releases"), list(per_page = 100)) %||% list()
bundle_downloads <- releases |>
  map(\(r) r |> pluck("assets") |> map(\(a) tibble(name = a |> pluck("name"), n = a |> pluck("download_count")))) |>
  list_flatten() |>
  list_rbind() |>
  (\(d) if (nrow(d) == 0) list() else d |>
    mutate(id = str_remove(name, "\\.zip$")) |>
    filter(id %in% ids) |>
    summarise(n = sum(n), .by = id) |>
    deframe() |>
    as.list())()

# 4. Repository facts and pseudonymised contributors
repo_info <- gh_get(glue("repos/{repo}"))
contributors <- gh_get(glue("repos/{repo}/contributors"), list(per_page = 100)) %||% list()

# 5. Worker counters
worker <- if (nzchar(api_base)) json_get(str_c(str_remove(api_base, "/$"), "/v1/stats/summary")) else NULL

stats <- list(
  generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  legacy = legacy,
  github = list(
    available = !is.null(repo_info),
    stars = repo_info |> pluck("stargazers_count"),
    forks = repo_info |> pluck("forks_count"),
    watchers = repo_info |> pluck("subscribers_count"),
    open_issues = repo_info |> pluck("open_issues_count"),
    contributors = contributors |> map(\(c) list(name = pseudonym(c |> pluck("login")), commits = c |> pluck("contributions"))),
    traffic_daily = traffic_daily,
    traffic_snapshots = length(traffic_files),
    bundle_downloads = bundle_downloads
  ),
  live = worker,
  live_available = !is.null(worker)
)

write_site_json(stats, path(root, "site", "data", "stats.json"), pretty = TRUE)
log_step("stats.json written (legacy: {legacy |> pluck('kind')}, GitHub: {!is.null(repo_info)}, worker: {!is.null(worker)}).")
