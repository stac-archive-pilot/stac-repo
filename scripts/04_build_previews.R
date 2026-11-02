# =============================================================================
# 04_build_previews.R
# -----------------------------------------------------------------------------
# Generates previews for every file in site/data/catalog.json:
#   pdf-convert / sheet -> previews/<id>/<file>.pdf      (LibreOffice headless)
#   qsf-items           -> previews/<id>/<file>.json     (Qualtrics JSON)
#   que-items           -> previews/<id>/<file>.json     (MediaLab, mdbtools)
#   lss-items           -> previews/<id>/<file>.json     (LimeSurvey XML)
#   xml-outline         -> previews/<id>/<file>.json     (PsychoPy, SoSci, EFS)
#   zip-tree            -> previews/<id>/<file>.json     (listing + junk flags)
#   table / codebook    -> previews/<id>/<file>.json
# PDFs, images, code and markdown are previewed from the file itself.
#
# Incremental: previews/manifest.json stores the source SHA-256 per preview;
# unchanged sources are skipped (CI restores previews from cache).
#
# Usage: Rscript scripts/04_build_previews.R [--force]
# =============================================================================

source("scripts/00_helpers.R")

force   <- "--force" %in% commandArgs(trailingOnly = TRUE)
root    <- stac_root()
catalog <- read_json(path(root, "site", "data", "catalog.json"), simplifyVector = FALSE)
prev_root <- path(root, "site", "previews")
manifest_file <- path(prev_root, "manifest.json")
manifest <- if (file_exists(manifest_file) && !force) read_json(manifest_file) else list()

# --- 1. Work list ------------------------------------------------------------
jobs <- catalog |>
  pluck("instruments") |>
  map(\(i) {
    i |>
      pluck("files") |>
      map(\(f) tibble(
        id = i |> pluck("id"),
        rel = i |> pluck("repo_path"),
        name = f |> pluck("name"),
        ptype = f |> pluck("preview", "type"),
        sha = f |> pluck("sha256")
      )) |>
      list_rbind()
  }) |>
  list_rbind() |>
  filter(ptype %in% c("pdf-convert", "sheet", "qsf-items", "que-items", "lss-items",
                      "xml-outline", "zip-tree", "table", "codebook")) |>
  mutate(
    src = path(root, rel, name) |> as.character(),
    key = str_c(id, "/", name),
    cached = map2_lgl(key, sha, \(k, s) identical(manifest |> pluck(k), s)) &
      map2_lgl(id, name, \(i, n) any(file_exists(path(prev_root, i, str_c(n, c(".pdf", ".json"))))))
  )

todo <- jobs |> filter(!cached)
log_step("{nrow(jobs)} previewable files, {nrow(todo)} to (re)build.")

# --- 2. Office -> PDF (batched per instrument folder) -----------------------
office <- todo |> filter(ptype %in% c("pdf-convert", "sheet"))
office_out <- office |>
  group_by(id) |>
  group_map(\(g, k) {
    out <- convert_office_batch(pull(g, src), path(prev_root, pull(k, id)))
    tibble(key = pull(g, key), ok = !is.na(out))
  }) |>
  list_rbind()
if (nrow(office_out) > 0) log_step("PDF previews: {sum(pull(office_out, ok))}/{nrow(office_out)} converted.")

# --- 3. Structured JSON previews --------------------------------------------
json_out <- todo |>
  filter(!ptype %in% c("pdf-convert")) |>
  select(id, name, ptype, src, key) |>
  pmap(\(id, name, ptype, src, key) {
    prev <- switch(ptype,
      "qsf-items"   = items_preview(inspect_qsf(src), "qsf-items", name),
      "que-items"   = items_preview(inspect_que(src), "que-items", name),
      "lss-items"   = items_preview(inspect_lss(src), "lss-items", name),
      "xml-outline" = { x <- inspect_xml(src); list(kind = "xml-outline", file = name, ok = isTRUE(x |> pluck("ok")),
                         meta = list(root = x |> pluck("root")), flags = as.list(x |> pluck("flags")),
                         outline = (x |> pluck("outline")) |> (\(o) if (is.null(o)) list() else transpose(o))()) },
      "zip-tree"    = zip_preview(src, name),
      "table"       = table_preview(src, name),
      "codebook"    = { d <- inspect_data_file(src); list(kind = "codebook", file = name, ok = isTRUE(d |> pluck("ok")),
                         meta = list(n_vars = d |> pluck("n_vars"), n_rows_read = d |> pluck("n_rows_read")),
                         flags = as.list(d |> pluck("flags")),
                         variables = (d |> pluck("variables")) |> (\(v) if (is.null(v)) list() else transpose(v))()) },
      "sheet"       = {
        sheets <- tryCatch(readxl::excel_sheets(src), error = function(e) character())
        list(kind = "sheet", file = name, ok = length(sheets) > 0, flags = list(),
             sheets = sheets |> map(\(s) {
               d <- readxl::read_excel(src, sheet = s, n_max = 200, col_names = FALSE, col_types = "text",
                                       .name_repair = "minimal")
               list(name = s, rows = d |> as.list() |> transpose() |> map(\(r) unname(map_chr(r, \(v) v %||% ""))))
             }))
      },
      NULL
    )
    if (is.null(prev)) return(tibble(key = key, ok = FALSE))
    write_site_json(prev, path(prev_root, id, str_c(name, ".json")))
    tibble(key = key, ok = isTRUE(prev |> pluck("ok")))
  }) |>
  list_rbind()
if (nrow(json_out) > 0) log_step("JSON previews: {sum(pull(json_out, ok))}/{nrow(json_out)} parsed.")

# --- 4. Manifest ------------------------------------------------------------
done <- bind_rows(office_out, json_out) |> filter(ok) |> pull(key)
new_manifest <- manifest |>
  list_modify(!!!(todo |> filter(key %in% done) |> select(key, sha) |> deframe() |> as.list()))
write_site_json(new_manifest, manifest_file, pretty = TRUE)

failed <- setdiff(pull(todo, key), done)
if (length(failed) > 0) log_step("No preview for {length(failed)} file(s): {str_c(head(failed, 8), collapse = '; ')}")
log_step("Previews written to site/previews/ ({human_size(sum(file_size(dir_ls(prev_root, recurse = TRUE, type = 'file'))))}).")
