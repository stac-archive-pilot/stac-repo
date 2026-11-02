# =============================================================================
# 08_bundle_release.R
# -----------------------------------------------------------------------------
# Writes one zip per instrument into _release/ (<id>.zip) for the GitHub
# release. Release assets keep a permanent download_count, which is the only
# durable per-instrument download counter GitHub offers; 05_fetch_stats.R
# reads it back. Each bundle contains the instrument files, README.md,
# stac.yml and a CITE.txt with the references and the STAC release tag.
#
# Env: STAC_RELEASE_TAG (e.g. v2026.11.0)
# Usage: Rscript scripts/08_bundle_release.R
# =============================================================================

source("scripts/00_helpers.R")

root <- stac_root()
tag  <- Sys.getenv("STAC_RELEASE_TAG", str_c("dev-", format(Sys.Date())))
out  <- path(root, "_release")
dir_create(out)
site_cfg <- read_yaml(path(root, "config", "site.yml"))

bundles <- find_instrument_dirs(root) |>
  map(\(dir) {
    meta <- read_stac_yml(dir)
    id   <- meta |> pluck("id")
    cite <- c(
      glue("{meta |> pluck('acronym') %||% ''} {meta |> pluck('title')}"),
      glue("STAC release {tag}"),
      "",
      "Please cite the original source(s):",
      unlist(meta |> pluck("references", "primary")) %||% "(no reference recorded yet)",
      "",
      "STAC access point:",
      site_cfg |> pluck("legacy", "paper_citation"),
      "",
      glue("License: {meta |> pluck('access', 'statement')}")
    )
    staging <- path_temp(str_c("bundle-", id), id)
    dir_create(staging)
    files <- c(instrument_files(dir), find_readme(dir), path(dir, "stac.yml")) |> discard(is.na)
    file_copy(files, path(staging, path_file(files)), overwrite = TRUE)
    write_lines(cite, path(staging, "CITE.txt"))
    zipfile <- path(out, str_c(id, ".zip"))
    if (file_exists(zipfile)) file_delete(zipfile)
    # zip from the parent so the archive opens into a folder named like the id
    old <- setwd(path_dir(staging)); on.exit(setwd(old), add = TRUE)
    utils::zip(zipfile, files = id, flags = "-r9Xq")
    setwd(old)
    tibble(asset = path_file(zipfile), bytes = as.numeric(file_size(zipfile)), sha256 = file_sha256(zipfile))
  }) |>
  list_rbind()

# Catalog table for the release (successor of the paper's supplemental
# Table SI1, osf.io/a5cps): one row per instrument, regenerated every release.
si1 <- find_instrument_dirs(root) |>
  map(\(dir) {
    m <- read_stac_yml(dir)
    f <- m |> pluck("files") %||% list()
    tibble(
      section = m |> pluck("section"),
      subsection = m |> pluck("subsection") %||% NA_character_,
      acronym = m |> pluck("acronym") %||% NA_character_,
      title = m |> pluck("title"),
      kind = m |> pluck("kind"),
      languages = f |> map(\(x) unlist(x |> pluck("languages"))) |> unlist() |> unique() |> sort() |> str_c(collapse = " "),
      formats = f |> map_chr(\(x) x |> pluck("format") %||% file_ext_lower(x |> pluck("path"))) |> unique() |> sort() |> str_c(collapse = " "),
      access_tier = m |> pluck("access", "tier"),
      origin = if (is.null(m |> pluck("provenance", "osf_path"))) "github" else "osf",
      added = m |> pluck("provenance", "added") %||% NA_character_,
      primary_reference = unlist(m |> pluck("references", "primary")) |> head(1) %||% NA_character_,
      path = path_rel(dir, root) |> as.character()
    )
  }) |>
  list_rbind() |>
  arrange(section, subsection, str_to_lower(coalesce(acronym, title)))
write_csv(si1, path(out, str_c("stac-catalog-", tag, ".csv")), na = "")
bundles <- bundles |>
  bind_rows(tibble(asset = str_c("stac-catalog-", tag, ".csv"),
                   bytes = as.numeric(file_size(path(out, str_c("stac-catalog-", tag, ".csv")))),
                   sha256 = file_sha256(path(out, str_c("stac-catalog-", tag, ".csv")))))

write_lines(glue::glue_data(bundles, "{sha256}  {asset}"), path(out, "SHA256SUMS.txt"))
log_step("{nrow(bundles)} bundles ({human_size(sum(pull(bundles, bytes)))}) written to _release/ for {tag}.")
