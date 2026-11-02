# =============================================================================
# 07_validate.R  (CI gate, job id "validate")
# -----------------------------------------------------------------------------
# Checks every instrument folder and exits with status 1 on errors.
#
#   ERROR  stac.yml missing or schema-invalid, id != folder name, file listed
#          in stac.yml but missing on disk, file > 95 MB, restricted access
#          tier with files committed to the public repository, NEW archive
#          with junk (.git, __MACOSX) or a NEW Qualtrics export with owner ID.
#   WARN   file on disk not described in stac.yml, README missing or with NA
#          placeholders, file > 50 MB, legacy migration issues (files that are
#          byte-identical to the OSF originals are reported, not blocked;
#          moderators decided on a 1:1 migration).
#
# Writes $STAC_REPORT_DIR/validation-report.md (shown on the CI run page).
# --audit additionally writes docs/audit-report.md (full legacy audit).
#
# Usage: Rscript scripts/07_validate.R [--audit]
# =============================================================================

source("scripts/00_helpers.R")

args       <- commandArgs(trailingOnly = TRUE)
root       <- stac_root()
cfg        <- read_stac_config(root)
report_dir <- Sys.getenv("STAC_REPORT_DIR", path(root, "_reports"))
schema_file <- path(root, "schema", "stac-instrument.schema.json")
legacy_map <- read_csv(path(root, "migration", "osf_path_map.csv"), show_col_types = FALSE)
public_tiers <- cfg |> pluck("taxonomy", "access_tiers") |> keep(\(t) isTRUE(t |> pluck("public_repo"))) |> names()

# --- Schema validation (jsonvalidate in CI, minimal fallback otherwise) ------
schema_check <- if (requireNamespace("jsonvalidate", quietly = TRUE)) {
  validator <- jsonvalidate::json_validator(schema_file, engine = "ajv")
  function(meta) {
    json <- toJSON(meta, auto_unbox = TRUE, null = "null", na = "null")
    ok <- validator(json, verbose = TRUE, greedy = TRUE)
    if (ok) character() else attr(ok, "errors") |>
      (\(e) str_c(pull(e, instancePath), " ", pull(e, message)))()
  }
} else {
  log_step("jsonvalidate not installed: using the minimal built-in schema check.")
  schema <- read_json(schema_file)
  function(meta) {
    req  <- schema |> pluck("required") |> unlist()
    tier_enum <- schema |> pluck("properties", "access", "properties", "tier", "enum") |> unlist()
    c(
      setdiff(req, names(meta)) |> map_chr(\(k) str_c("missing required field '", k, "'")),
      if (!(meta |> pluck("kind") %||% "") %in% c("scale", "task", "method")) "kind must be scale, task or method",
      if (!(meta |> pluck("access", "tier") %||% "") %in% tier_enum) "access.tier is not a known tier",
      if (!str_detect(meta |> pluck("id") %||% "", "^[a-z0-9]+(-[a-z0-9]+)*$")) "id must be a lower-case slug"
    )
  }
}

#' Is this exact file a byte-identical legacy OSF original?
is_legacy <- function(repo_path, sha) {
  legacy_map |> filter(repo_path == !!repo_path, sha256 == !!sha) |> nrow() > 0
}

# --- Check one instrument --------------------------------------------------------
check_instrument <- function(dir) {
  pp   <- path_parts(dir, root)
  rel  <- str_c("instruments/", pp |> pluck("rel"))
  out  <- list()
  add  <- function(level, msg, file = NA_character_) {
    out[[length(out) + 1]] <<- tibble(instrument = rel, level = level, file = file, message = msg)
  }

  meta <- read_stac_yml(dir)
  if (is.null(meta)) { add("error", "stac.yml is missing"); return(list_rbind(out)) }
  walk(schema_check(meta), \(m) add("error", str_c("stac.yml: ", m)))
  if (!identical(meta |> pluck("id"), pp |> pluck("slug"))) add("error", "stac.yml id differs from the folder name")

  disk  <- instrument_files(dir)
  names_disk <- path_file(disk)
  names_meta <- meta |> pluck("files") |> map_chr(\(f) f |> pluck("path") %||% NA_character_)
  external   <- meta |> pluck("files") |> map_lgl(\(f) isTRUE(f |> pluck("external")))
  walk(setdiff(names_meta[!external], names_disk), \(f) add("error", "listed in stac.yml but missing on disk", f))
  walk(setdiff(names_disk, names_meta), \(f) add("warn", "file not described in stac.yml", f))

  tier <- meta |> pluck("access", "tier") %||% ""
  if (!tier %in% public_tiers && length(disk) > 0) {
    add("error", glue("access tier '{tier}' must not have files in the public repository; move them to the restricted store"))
  }

  rd <- parse_readme(find_readme(dir))
  if (!isTRUE(rd |> pluck("present"))) add("warn", "README.md missing")
  else if (isTRUE((rd |> pluck("na_fields") %||% 0) > 0)) add("warn", glue("README has {rd |> pluck('na_fields')} NA placeholder line(s)"))

  walk(disk, \(f) {
    nm   <- path_file(f)
    mb   <- as.numeric(file_size(f)) / 1024^2
    sha  <- file_sha256(f)
    legacy <- is_legacy(str_c(rel, "/", nm), sha)
    lvl  <- if (legacy) "warn" else "error"
    if (mb > 95) add("error", sprintf("%.1f MB exceeds the 95 MB limit (GitHub rejects files > 100 MB)", mb), nm)
    else if (mb > 50) add("warn", sprintf("%.1f MB; consider a release asset", mb), nm)
    ext <- file_ext_lower(nm)
    if (ext == "zip") {
      z <- inspect_zip(f)
      walk(intersect(z |> pluck("flags"), c("zip_embedded_git", "zip_macos_junk")), \(fl) add(lvl, str_c(fl, if (legacy) " (legacy OSF file)" else ""), nm))
      if ("zip_contains_test_data" %in% (z |> pluck("flags"))) add("warn", "zip contains a data/ folder with recorded runs", nm)
    }
    if (ext == "qsf") {
      q <- inspect_qsf(f)
      if ("qsf_owner_id" %in% (q |> pluck("flags"))) add(lvl, str_c("Qualtrics SurveyOwnerID present", if (legacy) " (legacy OSF file)" else ""), nm)
      if ("qsf_placeholder_question" %in% (q |> pluck("flags"))) add("warn", "Qualtrics default question left in survey", nm)
    }
    if (str_detect(nm, "(?i)\\.ds_store$|^\\._")) add("error", "system junk file", nm)
  })
  list_rbind(out)
}

dirs <- find_instrument_dirs(root)
log_step("Validating {length(dirs)} instrument folders ...")
findings <- dirs |> map(check_instrument) |> list_rbind()
if (nrow(findings) == 0) findings <- tibble(instrument = character(), level = character(), file = character(), message = character())

n_err  <- findings |> filter(level == "error") |> nrow()
n_warn <- findings |> filter(level == "warn") |> nrow()

# --- Report ------------------------------------------------------------------------
md_table <- function(d) {
  if (nrow(d) == 0) return("_none_")
  c("| Instrument | File | Message |", "|---|---|---|",
    d |> mutate(file = replace_na(file, "")) |>
      glue::glue_data("| `{str_remove(instrument, '^instruments/')}` | {file} | {message} |")) |>
    str_c(collapse = "\n")
}

report <- c(
  "## STAC validation",
  "",
  glue("**{length(dirs)}** instruments checked: **{n_err}** error(s), **{n_warn}** warning(s)."),
  "",
  "### Errors",
  md_table(findings |> filter(level == "error")),
  "",
  "<details><summary>Warnings</summary>",
  "",
  md_table(findings |> filter(level == "warn")),
  "",
  "</details>"
)
dir_create(report_dir)
write_lines(report, path(report_dir, "validation-report.md"))
write_csv(findings, path(report_dir, "validation-findings.csv"))

# --- Optional full audit for docs/ -----------------------------------------------------
if ("--audit" %in% args) {
  cat_file <- path(root, "site", "data", "catalog.json")
  cat_json <- if (file_exists(cat_file)) read_json(cat_file, simplifyVector = FALSE) else NULL
  flag_counts <- if (is.null(cat_json)) tibble() else cat_json |>
    pluck("instruments") |>
    map(\(i) tibble(id = i |> pluck("id"), flag = c(unlist(i |> pluck("quality", "flags")), unlist(i |> pluck("quality", "file_flags"))))) |>
    list_rbind() |>
    count(flag, sort = TRUE, name = "instruments")
  audit <- c(
    "# STAC migration audit",
    "",
    glue("Generated {format(Sys.Date())} by `scripts/07_validate.R --audit` from the OSF archive of project 4s9p6."),
    "Files were migrated 1:1 (SHA-256 verified); nothing below was changed in authors' files.",
    "",
    "## Summary by flag (instruments affected)",
    "",
    if (nrow(flag_counts) == 0) "_catalog not built_" else c("| Flag | Instruments |", "|---|---|",
      glue::glue_data(flag_counts, "| `{flag}` | {instruments} |")),
    "",
    "## All findings",
    "",
    md_table(findings)
  )
  write_lines(audit, path(root, "docs", "audit-report.md"))
  log_step("docs/audit-report.md written.")
}

log_step("{n_err} error(s), {n_warn} warning(s). Report: {path(report_dir, 'validation-report.md')}")
if (n_err > 0) quit(save = "no", status = 1)
