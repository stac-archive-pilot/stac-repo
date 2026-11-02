# =============================================================================
# 03_build_catalog.R
# -----------------------------------------------------------------------------
# Builds site/data/catalog.json from all instruments/**/stac.yml plus the real
# file inventory, and mirrors downloadable files into site/files/.
#
#   * stac.yml is the metadata source; the file system is the truth for which
#     files exist (drift between README, stac.yml and disk is flagged).
#   * Files above max_site_file_mb (config/site.yml, env STAC_MAX_SITE_FILE_MB
#     overrides) stay out of the Pages site and link to the repository.
#
# Usage: Rscript scripts/03_build_catalog.R [--no-copy]
# =============================================================================

source("scripts/00_helpers.R")

args     <- commandArgs(trailingOnly = TRUE)
copy     <- !"--no-copy" %in% args
root     <- stac_root()
cfg      <- read_stac_config(root)
site_cfg <- read_yaml(path(root, "config", "site.yml"))

if (!isTRUE(l10n_info()[["UTF-8"]])) {
  warning("R is not running in a UTF-8 locale; set LANG=C.UTF-8 (file names contain en dashes).")
}

# --- 1. Instrument records ---------------------------------------------------
dirs <- find_instrument_dirs(root)
log_step("Building catalog for {length(dirs)} instruments ...")
instruments <- dirs |>
  map(\(d) build_instrument_record(d, cfg, site_cfg, root), .progress = FALSE) |>
  (\(l) l[order(map_chr(l, \(i) str_to_lower(i |> pluck("display"))))])()

# --- 2. Facet label maps (the site counts facets client-side) ---------------
used <- function(field) instruments |> map(\(i) unlist(i |> pluck(field))) |> unlist() |> unique()
lang_cfg <- cfg |> pluck("taxonomy", "languages")

facets <- list(
  sections    = cfg |> pluck("taxonomy", "sections") |> map(\(s) list(label = s |> pluck("label"), blurb = s |> pluck("blurb"))),
  subsections = cfg |> pluck("taxonomy", "subsections"),
  kinds       = cfg |> pluck("taxonomy", "kinds"),
  languages   = used("languages") |> sort() |> set_names() |> map(\(l) lang_cfg |> pluck(l, "label") %||% l),
  platforms   = used("platforms") |> sort() |> set_names() |> map(\(p) cfg |> pluck("formats", "platform_labels", p) %||% p),
  families    = cfg |> pluck("formats", "family_labels"),
  tiers       = cfg |> pluck("taxonomy", "access_tiers"),
  tags        = used("tags") |> sort() |> as.list()
)

# --- 3. Totals -------------------------------------------------------------
all_files <- instruments |> map(\(i) i |> pluck("files")) |> list_flatten()
totals <- list(
  instruments = length(instruments),
  files = length(all_files),
  bytes = sum(map_dbl(all_files, "size")),
  languages = length(facets |> pluck("languages")),
  platforms = length(facets |> pluck("platforms")),
  survey_ready = sum(map_lgl(instruments, "survey_ready")),
  added_on_github = sum(map_chr(instruments, "origin") == "github"),
  by_kind = instruments |> map_chr("kind") |> table() |> as.list() |> map(as.integer),
  by_section = instruments |> map_chr("section") |> table() |> as.list() |> map(as.integer),
  by_ext = all_files |> map_chr("ext") |> table() |> sort(decreasing = TRUE) |> as.list() |> map(as.integer),
  by_language = instruments |> map(\(i) unlist(i |> pluck("languages"))) |> unlist() |> table() |>
    sort(decreasing = TRUE) |> as.list() |> map(as.integer),
  quality = instruments |> map_chr(\(i) i |> pluck("quality", "level")) |> table() |> as.list() |> map(as.integer)
)

catalog <- list(
  generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  schema_version = 1L,
  repo = site_cfg |> pluck("repo"),
  legacy = site_cfg |> pluck("legacy"),
  backend = site_cfg |> pluck("backend"),
  giscus = site_cfg |> pluck("giscus"),
  totals = totals,
  facets = facets,
  formats = cfg |> pluck("formats", "formats"),
  instruments = instruments
)

write_site_json(catalog, path(root, "site", "data", "catalog.json"))
write_atom_feed(instruments, site_cfg |> pluck("repo", "pages_url"), path(root, "site", "feed.xml"))
log_step("catalog.json: {totals |> pluck('instruments')} instruments, {totals |> pluck('files')} files, {human_size(totals |> pluck('bytes'))}.")

# --- 4. Mirror downloadable files into site/files ---------------------------
if (copy) {
  target_root <- path(root, "site", "files")
  if (dir_exists(target_root)) dir_delete(target_root)
  copied <- instruments |>
    map(\(i) {
      rel <- i |> pluck("repo_path") |> str_remove("^instruments/")
      i |>
        pluck("files") |>
        keep(\(f) isTRUE(f |> pluck("on_site"))) |>
        map_dbl(\(f) {
          dest <- path(target_root, rel, f |> pluck("name"))
          dir_create(path_dir(dest))
          file_copy(path(root, "instruments", rel, f |> pluck("name")), dest, overwrite = TRUE)
          f |> pluck("size")
        })
    }) |>
    unlist()
  log_step("Mirrored {length(copied)} files ({human_size(sum(copied))}) into site/files/.")
}
