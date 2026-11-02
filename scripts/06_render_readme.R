# =============================================================================
# 06_render_readme.R
# -----------------------------------------------------------------------------
# Regenerates the badge row and the instrument tables in README.md between
# the markers <!-- STAC:BADGES:START/END --> and <!-- STAC:TABLES:START/END -->
# from site/data/catalog.json. Everything outside the markers is hand-written.
#
# Usage: Rscript scripts/06_render_readme.R
# =============================================================================

source("scripts/00_helpers.R")

root    <- stac_root()
catalog <- read_json(path(root, "site", "data", "catalog.json"), simplifyVector = FALSE)
pages   <- catalog |> pluck("repo", "pages_url")
totals  <- catalog |> pluck("totals")
langs   <- catalog |> pluck("facets", "languages")

#' Replace the text between two HTML comment markers.
replace_block <- function(text, key, new) {
  rx <- glue("(?s)(<!-- STAC:{key}:START -->).*?(<!-- STAC:{key}:END -->)")
  if (!str_detect(text, rx)) stop(glue("Marker STAC:{key} not found in README.md"))
  str_replace(text, rx, str_c("\\1\n", str_replace_all(new, "\\\\", "\\\\\\\\"), "\n\\2"))
}

shield <- function(label, value, color) {
  glue("<img alt=\"{label}\" src=\"https://img.shields.io/badge/{str_replace_all(label, '-', '--')}-{value}-{color}\">")
}
badges <- c(
  shield("instruments", totals |> pluck("instruments"), "3b32c4"),
  shield("files", totals |> pluck("files"), "3b32c4"),
  shield("languages", totals |> pluck("languages"), "3b32c4"),
  shield("survey-ready", totals |> pluck("survey_ready"), "1d7a4b")
) |> str_c(collapse = " ")

# One collapsible table per section (and subsection)
inst <- catalog |>
  pluck("instruments") |>
  map(\(i) tibble(
    id = i |> pluck("id"),
    display = i |> pluck("display"),
    title = i |> pluck("title"),
    acronym = i |> pluck("acronym") %||% NA_character_,
    section = i |> pluck("section_label"),
    subsection = i |> pluck("subsection_label") %||% NA_character_,
    languages = i |> pluck("languages") |> unlist() |> map_chr(\(l) langs |> pluck(l) %||% l) |> str_c(collapse = ", "),
    formats = i |> pluck("files") |> map_chr("ext") |> unique() |> sort() |> (\(x) str_c("`", x, "`", collapse = " "))(),
    platforms = i |> pluck("platforms") |> unlist() |> str_c(collapse = ", "),
    access = i |> pluck("access", "short"),
    path = i |> pluck("repo_path")
  )) |>
  list_rbind() |>
  mutate(
    group = if_else(is.na(subsection), section, str_c(section, ": ", subsection)),
    name = if_else(is.na(acronym), title, str_c("**", acronym, "** ", title)),
    link = glue("[{name}]({path})"),
    web = glue("[view]({pages}#/instrument/{id})")
  )

tables <- inst |>
  arrange(group, str_to_lower(display)) |>
  group_by(group) |>
  group_map(\(g, k) c(
    glue("<details><summary><b>{pull(k, group)}</b> ({nrow(g)})</summary>"),
    "",
    "| Instrument | Languages | Formats | Access | |",
    "|---|---|---|---|---|",
    glue::glue_data(g, "| {link} | {languages} | {formats} | {access} | {web} |"),
    "",
    "</details>"
  )) |>
  unlist() |>
  str_c(collapse = "\n")

readme_file <- path(root, "README.md")
readme <- read_file(readme_file) |>
  replace_block("BADGES", badges) |>
  replace_block("TABLES", tables)
write_file(readme, readme_file)
log_step("README.md tables regenerated ({nrow(inst)} instruments).")
