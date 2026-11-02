# =============================================================================
# 09_intake_issue.R
# -----------------------------------------------------------------------------
# Turns a "New instrument" issue form into an instrument scaffold under
# instruments/ (used by .github/workflows/intake.yml):
#   * parses the form JSON (stefanbuck/github-issue-parser output)
#   * downloads attachments (only https://github.com/user-attachments/...),
#     unpacks zip files safely (no absolute paths, no "..", no junk)
#   * writes stac.yml (stage: in-review) and README.md
#
# The issue body is untrusted input: no token is used, URLs are allow-listed,
# file names are sanitised and sizes limited.
#
# Env: ISSUE_BODY_FILE, INTAKE_MODE (preview|pr), ISSUE_NUMBER, ISSUE_TITLE,
#      ISSUE_AUTHOR, ISSUE_URL
# Usage: Rscript scripts/09_intake_issue.R <issue-number>
# =============================================================================

source("scripts/00_helpers.R")
suppressPackageStartupMessages(library(httr2))

root  <- stac_root()
cfg   <- read_stac_config(root)
issue <- commandArgs(trailingOnly = TRUE)[1] %||% Sys.getenv("ISSUE_NUMBER")
body_file <- Sys.getenv("ISSUE_BODY_FILE")
if (!nzchar(body_file) || !file_exists(body_file)) stop("ISSUE_BODY_FILE not set or missing.")
form  <- read_json(body_file)
max_bytes <- 95 * 1024^2

field <- function(key) {
  v <- form |> pluck(key) %||% ""
  if (is.list(v)) unlist(v) else str_trim(v)
}
strip_fences <- function(x) x |> str_remove("^```[a-zA-Z]*\\s*\\n?") |> str_remove("\\n?```\\s*$") |> str_trim()
split_multi  <- function(x) if (length(x) == 0 || identical(x, "")) character() else str_split(x, ",\\s+") |> pluck(1)

# --- Map form answers to metadata ------------------------------------------------
section_map <- tribble(
  ~label,                                     ~section,                                   ~subsection,
  "Art and aesthetics",                       "art-and-aesthetics",                       NA,
  "Creativity: self-report scales",           "creativity",                               "self-report-scales",
  "Creativity: tasks",                        "creativity",                               "tasks",
  "Creativity: methods and scoring",          "creativity",                               "methods-and-scoring",
  "Personality and individual differences",   "personality-and-individual-differences",   NA
)
sec <- section_map |> filter(label == field("section"))
if (nrow(sec) == 0) stop(glue("Unknown section '{field('section')}'."))

acronym <- field("acronym")
title   <- field("title")
slug    <- slugify(str_c(c(acronym, title) |> discard(\(x) x == ""), collapse = " "))
rel     <- c("instruments", pull(sec, section), if (!is.na(pull(sec, subsection))) {
  if (pull(sec, subsection) == "methods-and-scoring") c("tasks", "methods-and-scoring") else pull(sec, subsection)
}, slug) |> str_c(collapse = "/")
target  <- path(root, rel)
if (dir_exists(target)) stop(glue("{rel} already exists; this looks like an update, handle it manually."))
dir_create(target)

criteria <- form |> pluck("criteria") |> unlist()
if (length(criteria) < 4) warning("Not all four inclusion criteria are confirmed.")

# --- Attachments -------------------------------------------------------------------
att_text <- str_c(field("attachments"), field("file_manifest"), collapse = "\n")
urls <- str_extract_all(att_text, "https://github\\.com/user-attachments/(assets|files)/[A-Za-z0-9._/%-]+") |>
  pluck(1) |> unique()

safe_name <- function(x) x |> path_file() |> str_replace_all("[^A-Za-z0-9._ ()-]", "_") |> str_trunc(120, ellipsis = "")

walk(urls, \(u) {
  resp <- tryCatch(request(u) |> req_timeout(120) |> req_perform(), error = function(e) NULL)
  if (is.null(resp)) { log_step("Download failed: {u}"); return(invisible()) }
  raw <- resp_body_raw(resp)
  if (length(raw) > max_bytes) { log_step("Skipped (too large): {u}"); return(invisible()) }
  cd  <- resp_header(resp, "content-disposition") %||% ""
  nm  <- str_match(cd, "filename\\*?=(?:UTF-8'')?\"?([^\";]+)")[, 2]
  nm  <- safe_name(if (is.na(nm)) path_file(u) else utils::URLdecode(nm))
  dest <- path(target, nm)
  writeBin(raw, dest)
  if (file_ext_lower(nm) == "zip") {
    lst <- utils::unzip(dest, list = TRUE) |> as_tibble()
    keep_files <- lst |>
      filter(!str_detect(Name, "/$"), !str_detect(Name, "(^|/)(__MACOSX|\\.git)/|(^|/)\\.DS_Store$|(^|/)\\._"),
             !str_detect(Name, "^/|\\.\\./"), Length <= max_bytes) |>
      pull(Name)
    tmp <- path_temp(str_c("intake-", issue))
    utils::unzip(dest, files = keep_files, exdir = tmp, junkpaths = TRUE)
    walk(dir_ls(tmp, type = "file"), \(f) file_move(f, path(target, safe_name(f))))
    file_delete(dest)
  }
})

# --- Metadata files -----------------------------------------------------------------
files <- instrument_files(target) |>
  map(\(f) list(path = path_file(f), format = file_ext_lower(f), languages = as.list(detect_languages(path_file(f), cfg)),
                platform = detect_platform(path_file(f), cfg), role = detect_role(path_file(f), cfg), citation = NA_character_))

contributors <- field("contributors") |> strip_fences() |> str_split("\\n") |> pluck(1) |>
  discard(\(l) str_trim(l) == "") |>
  map(\(l) {
    orcid <- str_extract(l, "\\d{4}-\\d{4}-\\d{4}-\\d{3}[\\dX]")
    list(name = l |> str_remove("\\(?https?://orcid\\.org/\\S+\\)?") |> str_remove(orcid %||% "") |> str_remove("[,;|-]\\s*$") |> str_squish(),
         orcid = orcid, role = NA_character_)
  })

refs <- field("references") |> strip_fences() |> str_split("\\n\\s*\\n|\\n(?=[A-Z][^\\n]+\\(\\d{4})") |> pluck(1) |> str_squish() |> discard(\(x) x == "")

meta <- list(
  schema_version = 1L,
  id = slug,
  acronym = if (acronym == "") NA_character_ else acronym,
  title = title,
  section = pull(sec, section),
  subsection = pull(sec, subsection),
  kind = field("kind") |> word(1) |> str_to_lower(),
  summary = field("summary"),
  tags = as.list(split_multi(field("tags")) |> slugify()),
  tags_curated = FALSE,
  access = list(
    tier = field("access_tier") |> str_extract("^[^:]+") |> str_trim(),
    statement = if (field("access_statement") == "") "Free to use for academic and non-commercial purposes." else field("access_statement"),
    source = glue("issue #{issue}"),
    verified = FALSE
  ),
  files = files,
  references = list(primary = as.list(refs), further = list()),
  dois = as.list(extract_dois(c(field("publication_doi"), refs))),
  administration = if (field("administration") == "") NA_character_ else field("administration"),
  contributors = contributors,
  status = list(stage = "in-review", readme_present = TRUE, readme_na_fields = 0L),
  provenance = list(osf_project = "https://osf.io/4s9p6", osf_path = NA_character_, migrated = NA_character_,
                    added = format(Sys.Date()),
                    intake_issue = Sys.getenv("ISSUE_URL", glue("#{issue}")), submitted_by = Sys.getenv("ISSUE_AUTHOR")),
  version = "1.0.0"
)
write_stac_yml(meta, target, root)

readme <- field("readme") |> strip_fences()
if (readme == "") {
  readme <- c(
    glue("# {str_c(c(acronym, title) |> discard(\\(x) x == ''), collapse = ' – ')}"), "",
    "## Overview", meta |> pluck("summary"), "",
    "## Files", map_chr(files, \(f) glue("- **{f |> pluck('path')}**")), "",
    "## Administration and Scoring", meta |> pluck("administration") %||% "NA", "",
    "## Citation", "If you use this measure in your published work, please cite the reference(s) below:", "", refs, "",
    "## Licensing", meta |> pluck("access", "statement")
  )
}
write_lines(readme, path(target, "README.md"))

log_step("Scaffold written to {rel} ({length(files)} files, mode {Sys.getenv('INTAKE_MODE', 'preview')}).")
