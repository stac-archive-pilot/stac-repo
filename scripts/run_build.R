# =============================================================================
# run_build.R
# -----------------------------------------------------------------------------
# One command for a complete local build of the catalog website:
#   preflight checks -> 03 catalog -> 04 previews -> 05 stats -> 06 README
#   -> 07 validation report
# Run from the repository root (or open stac.Rproj in RStudio first):
#
#   Rscript scripts/run_build.R            full build
#   Rscript scripts/run_build.R --quick    catalog only (no previews, no stats)
#
# Then serve the site:  Rscript scripts/serve.R   (or: cd site && python -m http.server 8000)
# =============================================================================

args  <- commandArgs(trailingOnly = TRUE)
quick <- "--quick" %in% args

# --- 1. Working directory ------------------------------------------------------
if (!file.exists("config/taxonomy.yml")) {
  stop("Run this script from the repository root (the folder with config/, scripts/, site/). ",
       "In RStudio: open stac.Rproj, then source scripts/run_build.R.", call. = FALSE)
}

# --- 2. R packages ---------------------------------------------------------------
# Base R only here: packages may not be installed yet.
needed <- c("dplyr", "purrr", "tidyr", "stringr", "tibble", "glue", "fs", "yaml", "jsonlite",
            "readr", "digest", "commonmark", "xml2", "readxl", "haven", "httr2")
missing <- needed[!vapply(needed, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing) > 0) {
  stop("Missing R packages. Install them with:\n  install.packages(c(",
       paste0('"', missing, '"', collapse = ", "), "))", call. = FALSE)
}

source("scripts/00_helpers.R")

# --- 3. Environment checks ----------------------------------------------------------
if (!isTRUE(l10n_info()[["UTF-8"]])) {
  log_step("WARNING: R is not running in a UTF-8 locale. Folder names contain en dashes; ",
           "on Linux/macOS start R with LANG=en_US.UTF-8 (Windows: R >= 4.2 is UTF-8 by default).")
}
n_instr <- length(find_instrument_dirs())
n_files <- find_instrument_dirs() |> map_int(\(d) length(instrument_files(d))) |> sum()
log_step("{n_instr} instrument folders with {n_files} files found.")
if (n_files == 0) {
  stop("No instrument files found. With the 'lite' ZIP, restore them first from the OSF archive:\n",
       "  Rscript scripts/01_migrate_osf_archive.R path/to/unpacked/osfstorage-archive", call. = FALSE)
}

soffice <- find_soffice()
log_step("LibreOffice: {if (is.na(soffice)) 'NOT FOUND (Word/Excel/PowerPoint previews skipped; set STAC_SOFFICE)' else soffice}")
log_step("mdbtools:    {if (has_mdbtools()) 'found' else 'NOT FOUND (MediaLab .que previews skipped; macOS: brew install mdbtools, Linux: apt install mdbtools, Windows: use WSL or let GitHub Actions build them)'}")

# --- 4. Run the pipeline steps as separate R processes ------------------------------------
rscript <- file.path(R.home("bin"), if (.Platform$OS.type == "windows") "Rscript.exe" else "Rscript")
run_step <- function(script, ..., required = TRUE) {
  log_step("---- {script} ----")
  status <- system2(rscript, c(file.path("scripts", script), ...))
  if (status != 0 && required) stop(glue("{script} failed (exit status {status})."), call. = FALSE)
  invisible(status)
}

run_step("03_build_catalog.R")
if (!quick) {
  run_step("04_build_previews.R")
  run_step("05_fetch_stats.R", required = FALSE)
  run_step("06_render_readme.R")
}
run_step("07_validate.R", required = FALSE)

log_step("Done. Serve the site with:  Rscript scripts/serve.R   then open http://localhost:8000")
