# =============================================================================
# STAC pipeline helpers
# -----------------------------------------------------------------------------
# All larger functions of the STAC build pipeline live here. Every numbered
# script sources this file first:
#
#   01_migrate_osf_archive.R   one-time: OSF archive -> instruments/ tree
#   02_bootstrap_metadata.R    one-time: README.md  -> stac.yml (draft)
#   03_build_catalog.R         stac.yml + files     -> site/data/catalog.json
#   04_build_previews.R        files                -> site/previews/**
#   05_fetch_stats.R           GitHub + worker API  -> site/data/stats.json
#   06_render_readme.R         catalog              -> README.md tables
#   07_validate.R              CI gate for pull requests
#   08_bundle_release.R        per-instrument zip bundles for releases
#   09_intake_issue.R          issue form           -> instrument scaffold
#
# Conventions: tidyverse style, native pipe, purrr instead of loops (for()
# only where side effects or retries make it clearer), no paste() (str_c /
# glue), no `$` on data frames (pull()). Regex backslashes are doubled.
# =============================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(purrr)
  library(tidyr)
  library(stringr)
  library(tibble)
  library(glue)
  library(fs)
  library(yaml)
  library(jsonlite)
  library(readr)
})

options(warn = 1, stringsAsFactors = FALSE)

# -----------------------------------------------------------------------------
# Paths and configuration
# -----------------------------------------------------------------------------

#' Locate the repository root (the folder that holds config/taxonomy.yml).
stac_root <- function(start = getwd()) {
  dir <- path_abs(start)
  repeat {
    if (file_exists(path(dir, "config", "taxonomy.yml"))) return(dir)
    parent <- path_dir(dir)
    if (parent == dir) stop("Cannot find the STAC repository root (config/taxonomy.yml).")
    dir <- parent
  }
}

#' Read the format registry and the taxonomy once per script run.
read_stac_config <- function(root = stac_root()) {
  list(
    formats  = read_yaml(path(root, "config", "formats.yml")),
    taxonomy = read_yaml(path(root, "config", "taxonomy.yml"))
  )
}

#' Small logger that keeps CI output readable.
log_step <- function(...) {
  cat(format(Sys.time(), "%H:%M:%S"), " ", glue(..., .envir = parent.frame()), "\n", sep = "")
}

# -----------------------------------------------------------------------------
# Names, slugs and OSF folder parsing
# -----------------------------------------------------------------------------

#' URL- and file-system-safe slug ("K-DOCS – Kaufman ..." -> "k-docs-kaufman-...").
slugify <- function(x) {
  x |>
    str_replace_all("[–—]", "-") |>
    str_replace_all("&", " and ") |>
    iconv(from = "UTF-8", to = "ASCII//TRANSLIT", sub = "") |>
    str_to_lower() |>
    str_replace_all("[^a-z0-9]+", "-") |>
    str_remove_all("^-+|-+$")
}

#' Split an OSF folder name into acronym and title.
#' "HEXACO PI-R – HEXACO Personality ..." -> acronym "HEXACO PI-R".
#' Folders without " – " / " - " get acronym NA and the full name as title.
split_osf_name <- function(folder_name) {
  clean <- folder_name |> str_squish()
  m <- str_match(clean, "^(.*?)\\s+[–-]\\s*(.+)$")
  if (is.na(m[1, 1])) {
    return(list(acronym = NA_character_, title = clean |> str_remove_all("^\"|\"")))
  }
  list(acronym = str_squish(m[1, 2]), title = str_squish(m[1, 3]))
}

# -----------------------------------------------------------------------------
# File classification (format, language, platform, role)
# -----------------------------------------------------------------------------

#' Lower-case extension without dot; handles names like "Story.Generation.qsf".
file_ext_lower <- function(path) path |> path_ext() |> str_to_lower()

#' Tokens of a file stem, split on _ - . , and whitespace.
name_tokens <- function(file_name) {
  file_name |>
    path_ext_remove() |>
    str_to_lower() |>
    str_split("[_\\-\\s.,()]+") |>
    pluck(1) |>
    discard(\(t) t == "")
}

#' Format record from the registry (falls back to the generic entry).
format_info <- function(ext, cfg) {
  rec <- cfg |> pluck("formats", "formats", ext)
  if (is.null(rec)) rec <- cfg |> pluck("formats", "fallback")
  rec
}

#' ISO 639-1 codes found in the file name (may be several, e.g. AReA_English_German).
detect_languages <- function(file_name, cfg) {
  toks <- name_tokens(file_name)
  langs <- cfg |> pluck("taxonomy", "languages")
  langs |>
    keep(\(l) any(l |> pluck("tokens") %in% toks)) |>
    names()
}

#' Platform from the format registry, otherwise from file name tokens.
detect_platform <- function(file_name, cfg) {
  rec <- format_info(file_ext_lower(file_name), cfg)
  if (!is.null(rec |> pluck("platform"))) return(rec |> pluck("platform"))
  toks <- name_tokens(file_name)
  hit <- cfg |>
    pluck("formats", "platform_tokens") |>
    keep(\(tk) any(tk %in% toks)) |>
    names()
  if (length(hit) == 0) NA_character_ else hit[[1]]
}

#' Role of a file inside an instrument folder (heuristic, curated later).
detect_role <- function(file_name, cfg) {
  stem <- file_name |> path_ext_remove()
  low  <- str_to_lower(stem)
  fam  <- format_info(file_ext_lower(file_name), cfg) |> pluck("family")
  case_when(
    str_detect(stem, ",\\s*(19|20)\\d{2}$") | str_detect(low, "validation") ~ "reference",
    str_detect(low, "scoring|guideline") ~ "scoring",
    str_detect(low, "instruction") ~ "instructions",
    str_detect(low, "template") ~ "template",
    fam %in% c("image", "media") ~ "stimuli",
    fam %in% c("archive", "experiment") ~ "software",
    fam == "data" & !file_ext_lower(file_name) %in% c("csv", "tsv") ~ "data",
    .default = "instrument"
  )
}

# -----------------------------------------------------------------------------
# README.md parsing (OSF 2024 template)
# -----------------------------------------------------------------------------

#' Remove markdown escapes (OSF exports write KDOCS\_English.docx).
md_unescape <- function(x) x |> str_replace_all("\\\\([_*&#\\[\\]()\\\\-])", "\\1")

#' Split a README into its level-2 sections (named list, names lower-case).
readme_sections <- function(text) {
  lines <- text |> str_split("\\r?\\n") |> pluck(1)
  h2 <- which(str_detect(lines, "^##\\s+[^#]"))
  if (length(h2) == 0) return(list())
  ends <- c(h2[-1] - 1, length(lines))
  tibble(start = h2, end = ends) |>
    mutate(
      name = lines[start] |> str_remove("^##\\s+") |> str_squish() |> str_to_lower(),
      body = map2_chr(start, end, \(s, e) {
        if (e <= s) return("")
        lines[(s + 1):e] |> str_c(collapse = "\n") |> str_trim()
      })
    ) |>
    select(name, body) |>
    deframe() |>
    as.list()
}

#' TRUE when a section body is empty or literally "NA".
is_na_body <- function(x) is.null(x) || is.na(x) || str_trim(x) %in% c("", "NA", "N/A", "-")

#' File names listed in bold in the "Files" section.
readme_listed_files <- function(files_body) {
  if (is_na_body(files_body)) return(character())
  files_body |>
    md_unescape() |>
    str_match_all("\\*\\*([^*]+?)\\*\\*") |>
    pluck(1) |>
    (\(m) m[, 2])() |>
    str_remove(":\\s*$") |>
    str_squish() |>
    unique()
}

#' Per-file citations from "### <file>" blocks inside the Citation section.
#' Returns a named list file -> citation text (NA when the block says NA).
readme_file_citations <- function(citation_body) {
  if (is_na_body(citation_body)) return(list())
  blocks <- citation_body |> str_split("\\n(?=###\\s)") |> pluck(1)
  blocks |>
    keep(\(b) str_detect(b, "^###\\s")) |>
    map(\(b) {
      head <- b |> str_extract("^###[^\\n]*") |> str_remove("^###\\s+") |> md_unescape() |> str_squish()
      body <- b |> str_remove("^###[^\\n]*\\n?") |> md_unescape() |> str_squish()
      list(file = head, citation = if (is_na_body(body)) NA_character_ else body)
    }) |>
    (\(l) set_names(map(l, "citation"), map_chr(l, "file")))()
}

#' DOIs found anywhere in a text (normalised, trailing punctuation removed).
extract_dois <- function(text) {
  if (is.null(text) || all(is.na(text))) return(character())
  text |>
    str_c(collapse = "\n") |>
    str_extract_all("10\\.\\d{4,9}/[^\\s\"<>\\]\\)]+") |>
    pluck(1) |>
    str_remove("[.,;:]+$") |>
    unique()
}

#' Paragraphs that look like references (author-year pattern).
extract_references <- function(text) {
  if (is_na_body(text)) return(character())
  text |>
    md_unescape() |>
    str_split("\\n\\s*\\n") |>
    pluck(1) |>
    str_squish() |>
    keep(\(p) str_detect(p, "\\((19|20)\\d{2}[a-z]?\\)\\.\\s") & str_length(p) > 40) |>
    unique()
}

#' Parse one README.md into a structured list (NULL-safe for missing files).
parse_readme <- function(readme_path) {
  if (is.na(readme_path) || !file_exists(readme_path)) {
    return(list(present = FALSE, sections = list(), listed = character(),
                citations = list(), na_fields = NA_integer_))
  }
  text <- read_file(readme_path)
  secs <- readme_sections(text)
  cit  <- readme_file_citations(secs |> pluck("citation"))
  na_sections <- c("overview", "administration and scoring", "citation") |>
    keep(\(s) is_na_body(secs |> pluck(s)))
  na_lines <- text |> str_count("(?m)^\\s*NA\\s*$")
  list(
    present   = TRUE,
    text      = text,
    sections  = secs,
    listed    = readme_listed_files(secs |> pluck("files")),
    citations = cit,
    na_fields = as.integer(na_lines),
    na_sections = na_sections
  )
}

# -----------------------------------------------------------------------------
# Deep inspection of special formats (used by catalog + previews)
# -----------------------------------------------------------------------------

#' Run an external command and return stdout lines (NULL on failure).
run_cmd <- function(cmd, args) {
  out <- tryCatch(
    suppressWarnings(system2(cmd, args = shQuote(args), stdout = TRUE, stderr = FALSE)),
    error = function(e) NULL
  )
  if (!is.null(attr(out, "status")) && attr(out, "status") != 0) return(NULL)
  out
}

#' List a zip archive and flag junk that should not be redistributed.
inspect_zip <- function(zip_path) {
  lst <- tryCatch(utils::unzip(zip_path, list = TRUE), error = function(e) NULL)
  if (is.null(lst)) return(list(ok = FALSE, entries = tibble(), flags = "zip_unreadable"))
  entries <- lst |>
    as_tibble() |>
    transmute(path = Name, size = as.numeric(Length)) |>
    mutate(
      is_dir   = str_detect(path, "/$"),
      macosx   = str_detect(path, "(^|/)__MACOSX/|(^|/)\\.DS_Store$|(^|/)\\._"),
      git      = str_detect(path, "(^|/)\\.git/"),
      testdata = str_detect(path, "(^|/)data/[^/]+\\.(psydat|log|csv)$"),
      nested   = str_detect(str_to_lower(path), "\\.(zip|7z|rar)$")
    )
  flags <- c(
    if (any(pull(entries, macosx)))   "zip_macos_junk",
    if (any(pull(entries, git)))      "zip_embedded_git",
    if (any(pull(entries, testdata))) "zip_contains_test_data",
    if (any(pull(entries, nested)))   "zip_nested_archive"
  )
  list(
    ok = TRUE,
    entries = entries,
    flags = flags,
    junk_bytes = entries |> filter(macosx | git) |> pull(size) |> sum(),
    content_bytes = entries |> filter(!macosx, !git) |> pull(size) |> sum(),
    n_entries = nrow(entries)
  )
}

#' Strip HTML tags and entities from Qualtrics question text.
strip_html <- function(x) {
  x |>
    str_replace_all("(?i)<br\\s*/?>", " ") |>
    str_replace_all("<[^>]+>", " ") |>
    str_replace_all("&nbsp;", " ") |>
    str_replace_all("&amp;", "&") |>
    str_replace_all("&lt;", "<") |>
    str_replace_all("&gt;", ">") |>
    str_replace_all("&quot;", "\"") |>
    str_replace_all("&#39;", "'") |>
    str_squish()
}

#' Parse a Qualtrics .qsf into survey info + ordered item list.
inspect_qsf <- function(qsf_path) {
  q <- tryCatch(read_json(qsf_path, simplifyVector = FALSE), error = function(e) NULL)
  if (is.null(q)) return(list(ok = FALSE, flags = "qsf_unreadable"))
  entry <- q |> pluck("SurveyEntry")
  elements <- q |> pluck("SurveyElements") %||% list()
  sq <- elements |> keep(\(e) identical(e |> pluck("Element"), "SQ"))

  items <- sq |>
    map(\(e) {
      p <- e |> pluck("Payload")
      choices <- p |> pluck("Choices") %||% list()
      ch_order <- p |> pluck("ChoiceOrder") %||% names(choices)
      ch_text <- ch_order |>
        as.character() |>
        map_chr(\(k) choices |> pluck(k, "Display") %||% NA_character_) |>
        discard(is.na) |>
        strip_html()
      answers <- p |> pluck("Answers") %||% list()
      tibble(
        qid    = p |> pluck("QuestionID") %||% NA_character_,
        tag    = p |> pluck("DataExportTag") %||% NA_character_,
        type   = str_c(p |> pluck("QuestionType") %||% "", "/", p |> pluck("Selector") %||% ""),
        text   = strip_html(p |> pluck("QuestionText") %||% ""),
        labels = list(ch_text),
        scale  = list(answers |> map_chr(\(a) a |> pluck("Display") %||% NA_character_) |> discard(is.na) |> strip_html() |> unname())
      )
    }) |>
    list_rbind()

  # Order items by block flow when the BL element is available
  bl <- elements |> keep(\(e) identical(e |> pluck("Element"), "BL")) |> pluck(1, "Payload")
  if (!is.null(bl) && nrow(items) > 0) {
    order_ids <- bl |>
      map(\(b) b |> pluck("BlockElements") %||% list()) |>
      list_flatten() |>
      keep(\(be) identical(be |> pluck("Type"), "Question")) |>
      map_chr(\(be) be |> pluck("QuestionID") %||% NA_character_)
    items <- items |>
      mutate(.ord = match(qid, order_ids)) |>
      arrange(.ord) |>
      select(-.ord)
  }

  owner <- entry |> pluck("SurveyOwnerID")
  brand <- entry |> pluck("SurveyBrandID")
  list(
    ok = TRUE,
    survey_name = entry |> pluck("SurveyName") %||% NA_character_,
    language = entry |> pluck("SurveyLanguage") %||% NA_character_,
    brand = brand %||% NA_character_,
    n_items = nrow(items),
    items = items,
    flags = c(
      if (!is.null(owner) && nzchar(owner)) "qsf_owner_id",
      if (!is.null(brand) && nzchar(brand)) "qsf_brand_id",
      # Qualtrics default text left in the survey ("Click to write the question text")
      if (nrow(items) > 0 && any(str_detect(pull(items, text), "^Click to write"))) "qsf_placeholder_question"
    )
  )
}

#' Read a MediaLab .que (MS Access Jet DB) via mdbtools into an item list.
inspect_que <- function(que_path) {
  tables <- run_cmd("mdb-tables", c("-1", que_path))
  if (is.null(tables)) return(list(ok = FALSE, flags = "que_unreadable_mdbtools_missing"))
  read_tbl <- function(tbl) {
    csv <- run_cmd("mdb-export", c(que_path, tbl))
    if (is.null(csv) || length(csv) < 1) return(NULL)
    tryCatch(
      read_csv(I(str_c(csv, collapse = "\n")), col_types = cols(.default = col_character()),
               show_col_types = FALSE, progress = FALSE),
      error = function(e) NULL
    )
  }
  info <- if ("QuestionnaireInfo" %in% tables) read_tbl("QuestionnaireInfo") else NULL
  qtbl <- tables |>
    map(\(t) list(name = t, data = read_tbl(t))) |>
    keep(\(x) !is.null(x |> pluck("data")) && "QuestionWording" %in% names(x |> pluck("data"))) |>
    pluck(1, "data")
  if (is.null(qtbl)) return(list(ok = FALSE, flags = "que_no_question_table"))

  label_cols <- names(qtbl) |> keep(\(n) str_detect(n, "^PointLabel\\d+$"))
  items <- qtbl |>
    mutate(across(everything(), \(x) replace_na(x, ""))) |>
    mutate(.n = suppressWarnings(as.numeric(QuestionNumber))) |>
    arrange(.n) |>
    rowwise() |>
    mutate(labels = list(c_across(all_of(label_cols)) |> discard(\(v) v %in% c("", "none")))) |>
    ungroup() |>
    transmute(
      qid = QuestionNumber, tag = VariableName, type = QuestionType,
      text = QuestionWording |> str_replace_all("\\r?\\n", " ") |> str_squish(),
      labels
    )
  list(
    ok = TRUE,
    survey_name = info |> (\(d) if (is.null(d)) NA_character_ else pull(d, Name)[1])(),
    medialab_version = info |> (\(d) if (is.null(d) || !"Version" %in% names(d)) NA_character_ else pull(d, Version)[1])(),
    n_items = nrow(items),
    items = items,
    flags = character()
  )
}

#' PsychoPy / generic XML outline: root name + routines/components if present.
inspect_xml <- function(xml_path) {
  if (!requireNamespace("xml2", quietly = TRUE)) return(list(ok = FALSE, flags = "xml2_missing"))
  doc <- tryCatch(xml2::read_xml(xml_path), error = function(e) NULL)
  if (is.null(doc)) return(list(ok = FALSE, flags = "xml_unreadable"))
  root <- xml2::xml_name(doc)
  routines <- xml2::xml_find_all(doc, ".//Routines/*")
  outline <- if (length(routines) > 0) {
    routines |>
      map(\(r) tibble(
        routine = xml2::xml_attr(r, "name"),
        components = list(xml2::xml_children(r) |> map_chr(\(c) str_c(xml2::xml_name(c), ": ", xml2::xml_attr(c, "name") %||% "")))
      )) |>
      list_rbind()
  } else {
    xml2::xml_children(doc) |> map_chr(xml2::xml_name) |> table() |> enframe(name = "element", value = "count") |>
      mutate(count = as.integer(count))
  }
  list(ok = TRUE, root = root, outline = outline, flags = character())
}

#' Codebook for SPSS / Stata / SAS / RDS data files (haven).
inspect_data_file <- function(data_path) {
  ext <- file_ext_lower(data_path)
  dat <- tryCatch(
    switch(ext,
      sav = , zsav = haven::read_sav(data_path, n_max = 500),
      por = haven::read_por(data_path, n_max = 500),
      dta = haven::read_dta(data_path, n_max = 500),
      sas7bdat = haven::read_sas(data_path, n_max = 500),
      rds = readRDS(data_path),
      NULL
    ),
    error = function(e) NULL
  )
  if (is.null(dat) || !is.data.frame(dat)) return(list(ok = FALSE, flags = "data_unreadable"))
  vars <- names(dat) |>
    map(\(v) {
      col <- dat |> pull(all_of(v))
      tibble(
        variable = v,
        label = attr(col, "label") %||% NA_character_,
        type = class(col)[1],
        n_missing = sum(is.na(col)),
        value_labels = list(attr(col, "labels") |> (\(l) if (is.null(l)) character() else str_c(l, " = ", names(l)))())
      )
    }) |>
    list_rbind()
  list(ok = TRUE, n_rows_read = nrow(dat), n_vars = ncol(dat), variables = vars, flags = character())
}

# -----------------------------------------------------------------------------
# Instrument discovery and metadata
# -----------------------------------------------------------------------------

#' All instrument folders (folders containing a stac.yml or a README.md and no
#' instrument subfolders) below instruments/.
find_instrument_dirs <- function(root = stac_root()) {
  base <- path(root, "instruments")
  dir_ls(base, recurse = TRUE, type = "directory") |>
    keep(\(d) {
      has_meta <- file_exists(path(d, "stac.yml")) || file_exists(path(d, "README.md"))
      subdirs  <- dir_ls(d, type = "directory")
      has_meta || (length(subdirs) == 0 && length(dir_ls(d, type = "file")) > 0)
    }) |>
    unname()
}

#' README of an instrument folder: README.md, or a variant like AQT_README.md.
find_readme <- function(dir) {
  cand <- dir_ls(dir, type = "file", regexp = "(?i)(^|[/_\\-])readme\\.md$")
  if (length(cand) == 0) return(NA_character_)
  exact <- cand[path_file(cand) == "README.md"]
  unname(if (length(exact) > 0) exact[[1]] else cand[[1]])
}

#' Files of an instrument folder, excluding metadata files.
instrument_files <- function(dir) {
  readme <- find_readme(dir)
  dir_ls(dir, type = "file", all = FALSE) |>
    discard(\(f) path_file(f) %in% c("README.md", "stac.yml") || identical(unname(f), readme)) |>
    unname()
}

#' Section / subsection ids derived from the relative instrument path.
path_parts <- function(dir, root = stac_root()) {
  rel <- path_rel(dir, path(root, "instruments"))
  parts <- path_split(rel) |> pluck(1)
  list(
    rel = as.character(rel),
    section = parts[1],
    subsection = if (length(parts) > 2) parts[length(parts) - 1] else NA_character_,
    slug = parts[length(parts)]
  )
}

#' Tag suggestions from the taxonomy dictionary.
suggest_tags <- function(text, cfg) {
  rules <- cfg |> pluck("taxonomy", "tag_rules")
  text <- text |> discard(is.na) |> str_c(collapse = " ")
  if (length(text) == 0 || text == "") return(character())
  rules |>
    keep(\(rx) str_detect(str_to_lower(text), rx)) |>
    names()
}

#' Write stac.yml with a schema hint header so editors can validate it.
write_stac_yml <- function(meta, dir, root = stac_root()) {
  rel_schema <- path_rel(path(root, "schema", "stac-instrument.schema.json"), dir)
  header <- c(
    glue("# yaml-language-server: $schema={rel_schema}"),
    "# STAC instrument metadata. Human-readable docs stay in README.md;",
    "# this file is the machine-readable source for the catalog and badges.",
    ""
  )
  # NA -> YAML null, logicals -> true/false (YAML 1.2 tools read yes/no as text)
  handlers <- list(
    character = \(x) if (length(x) == 1 && is.na(x)) structure("null", class = "verbatim") else x,
    logical   = \(x) if (length(x) == 1 && is.na(x)) structure("null", class = "verbatim") else
      structure(if_else(x, "true", "false"), class = "verbatim"),
    integer   = \(x) if (length(x) == 1 && is.na(x)) structure("null", class = "verbatim") else x
  )
  body <- as.yaml(meta, indent.mapping.sequence = TRUE, line.sep = "\n", handlers = handlers)
  write_lines(c(header, body), path(dir, "stac.yml"))
}

#' Read stac.yml (NULL when absent).
read_stac_yml <- function(dir) {
  f <- path(dir, "stac.yml")
  if (!file_exists(f)) return(NULL)
  read_yaml(f)
}

# -----------------------------------------------------------------------------
# Hashing, pseudonyms, history
# -----------------------------------------------------------------------------

#' SHA-256 of a file (hex).
file_sha256 <- function(path) digest::digest(file = path, algo = "sha256")

#' Deterministic pseudonym ("curious-otter-3f9a") from a login or name.
#' Salt comes from env STAC_PSEUDONYM_SALT so names cannot be reversed by
#' hashing a list of known GitHub logins.
pseudonym <- function(x, salt = Sys.getenv("STAC_PSEUDONYM_SALT", "stac-dev-salt")) {
  adj <- c("curious", "bold", "quiet", "bright", "lucid", "nimble", "patient", "vivid",
           "gentle", "keen", "brisk", "calm", "witty", "deft", "sunny", "stellar")
  ani <- c("otter", "heron", "lynx", "finch", "badger", "marten", "ibis", "gecko",
           "puffin", "orca", "wren", "fox", "koala", "tapir", "egret", "civet")
  x |>
    map_chr(\(v) {
      h <- digest::hmac(salt, v, algo = "sha256")
      i <- strtoi(substr(h, 1, 2), 16L) %% length(adj) + 1
      j <- strtoi(substr(h, 3, 4), 16L) %% length(ani) + 1
      str_c(adj[i], "-", ani[j], "-", substr(h, 5, 8))
    })
}

#' Git history of one folder (empty tibble outside a git checkout).
git_history <- function(rel_dir, root = stac_root(), n = 30) {
  out <- run_cmd("git", c("-C", root, "log", str_c("-n", n), "--date=short",
                          "--format=%h\t%ad\t%an\t%s", "--", rel_dir))
  if (is.null(out) || length(out) == 0) {
    return(tibble(hash = character(), date = character(), author = character(), message = character()))
  }
  tibble(raw = out) |>
    separate_wider_delim(raw, "\t", names = c("hash", "date", "author", "message"), too_many = "merge") |>
    mutate(author = pseudonym(author))
}

# -----------------------------------------------------------------------------
# Quality scoring
# -----------------------------------------------------------------------------

#' 0-100 metadata quality score with transparent components.
quality_score <- function(readme_present, na_fields, n_unlisted, n_ghost,
                          share_lang, has_doi, access_verified, n_flags) {
  comp <- c(
    readme     = if (readme_present) 20 else 0,
    no_na      = if (is.na(na_fields)) 0 else max(0, 20 - 5 * na_fields),
    no_drift   = max(0, 15 - 5 * (n_unlisted + n_ghost)),
    languages  = round(10 * share_lang),
    doi        = if (has_doi) 15 else 0,
    access     = if (access_verified) 10 else 0,
    clean      = max(0, 10 - 5 * n_flags)
  )
  list(score = as.integer(sum(comp)), components = as.list(comp))
}

#' Badge level for a quality score.
quality_level <- function(score) {
  case_when(score >= 85 ~ "gold", score >= 65 ~ "silver", score >= 45 ~ "bronze", .default = "draft")
}

# -----------------------------------------------------------------------------
# JSON output
# -----------------------------------------------------------------------------

#' Write JSON the way the site expects (UTF-8, NA -> null, no auto_unbox surprises).
write_site_json <- function(x, file, pretty = FALSE) {
  dir_create(path_dir(file))
  write_json(x, file, auto_unbox = TRUE, na = "null", null = "null", pretty = pretty, digits = NA)
}

# -----------------------------------------------------------------------------
# Catalog building (used by 03_build_catalog.R)
# -----------------------------------------------------------------------------

#' Human-readable file size.
human_size <- function(bytes) {
  case_when(
    bytes >= 1024^3 ~ sprintf("%.1f GB", bytes / 1024^3),
    bytes >= 1024^2 ~ sprintf("%.1f MB", bytes / 1024^2),
    bytes >= 1024   ~ sprintf("%.0f KB", bytes / 1024),
    .default = sprintf("%.0f B", bytes)
  )
}

#' URL-encode each path segment (folder and file names keep spaces etc.).
url_path <- function(...) {
  c(...) |>
    str_split("/") |>
    unlist() |>
    map_chr(\(s) utils::URLencode(s, reserved = TRUE)) |>
    str_c(collapse = "/")
}

#' Where the site finds the preview of a file (deterministic convention that
#' 04_build_previews.R fulfils).
preview_url <- function(id, file_name, preview_type, href) {
  case_when(
    preview_type %in% c("pdf-native", "code", "markdown", "image", "media") ~ href,
    preview_type %in% c("pdf-convert") ~ url_path("previews", id, str_c(file_name, ".pdf")),
    preview_type %in% c("sheet") ~ url_path("previews", id, str_c(file_name, ".pdf")),
    preview_type %in% c("que-items", "qsf-items", "lss-items", "xml-outline", "zip-tree", "table", "codebook") ~
      url_path("previews", id, str_c(file_name, ".json")),
    .default = NA_character_
  )
}

#' Catalog record for one file of an instrument.
build_file_record <- function(file_path, meta_file, id, rel, cfg, site_cfg, listed) {
  nm    <- path_file(file_path)
  ext   <- file_ext_lower(nm)
  fmt   <- format_info(ext, cfg)
  bytes <- as.numeric(file_size(file_path))
  repo  <- site_cfg |> pluck("repo")
  gh_base <- glue("https://github.com/{repo |> pluck('owner')}/{repo |> pluck('name')}")
  max_mb  <- as.numeric(Sys.getenv("STAC_MAX_SITE_FILE_MB", site_cfg |> pluck("max_site_file_mb") %||% 50))
  on_site <- bytes <= max_mb * 1024^2
  href    <- if (on_site) url_path("files", rel, nm) else
    str_c(gh_base, "/raw/", repo |> pluck("branch"), "/", url_path("instruments", rel, nm))

  langs    <- meta_file |> pluck("languages") %||% detect_languages(nm, cfg)
  platform <- meta_file |> pluck("platform") %||% detect_platform(nm, cfg)
  role     <- meta_file |> pluck("role") %||% detect_role(nm, cfg)
  ptype    <- fmt |> pluck("preview") %||% "none"

  # Format-specific flags (cheap inspection; full previews come from 04)
  deep_flags <- switch(ext,
    zip = inspect_zip(file_path) |> pluck("flags"),
    qsf = inspect_qsf(file_path) |> pluck("flags"),
    character()
  )
  flags <- c(
    deep_flags,
    if (role == "reference" && ext == "pdf") "reference_article_check_license",
    if (length(langs) == 0 && role == "instrument") "language_unspecified",
    if (str_detect(str_to_lower(nm), "englsih")) "filename_typo",
    if (length(listed) > 0 && !nm %in% listed) "not_in_readme",
    if (bytes > 50 * 1024^2) "large_file",
    if (!on_site) "hosted_in_repository"
  )

  list(
    name = nm,
    ext = ext,
    format_label = fmt |> pluck("label"),
    family = fmt |> pluck("family"),
    mime = fmt |> pluck("mime"),
    platform = platform,
    platform_label = if (is.na(platform %||% NA)) NA_character_ else
      cfg |> pluck("formats", "platform_labels", platform) %||% platform,
    languages = as.list(unlist(langs)),
    role = role,
    variant = meta_file |> pluck("variant") %||% NA_character_,
    citation = meta_file |> pluck("citation") %||% NA_character_,
    size = bytes,
    size_h = human_size(bytes),
    sha256 = file_sha256(file_path),
    href = href,
    on_site = on_site,
    github_url = str_c(gh_base, "/blob/", repo |> pluck("branch"), "/", url_path("instruments", rel, nm)),
    preview = list(type = ptype, url = preview_url(id, nm, ptype, href), highlight = fmt |> pluck("highlight") %||% NA_character_),
    notes = fmt |> pluck("notes") %||% NA_character_,
    flags = as.list(flags)
  )
}

#' Catalog record for one instrument folder.
build_instrument_record <- function(dir, cfg, site_cfg, root = stac_root()) {
  meta <- read_stac_yml(dir)
  if (is.null(meta)) stop(glue("Missing stac.yml in {dir}. Run 02_bootstrap_metadata.R."))
  pp   <- path_parts(dir, root)
  rel  <- pp |> pluck("rel")
  id   <- meta |> pluck("id")
  rd   <- parse_readme(find_readme(dir))
  listed <- rd |> pluck("listed")

  disk_files <- instrument_files(dir)
  meta_files <- meta |> pluck("files") %||% list()
  meta_by_name <- set_names(meta_files, map_chr(meta_files, \(m) m |> pluck("path")))

  files <- disk_files |>
    map(\(f) build_file_record(f, meta_by_name |> pluck(path_file(f)), id, rel, cfg, site_cfg, listed))
  file_names <- map_chr(files, "name")

  ghost      <- setdiff(listed, file_names)
  unlisted   <- if (length(listed) > 0) setdiff(file_names, listed) else file_names
  instr_files <- files |> keep(\(f) f |> pluck("role") == "instrument")
  share_lang <- if (length(instr_files) == 0) 1 else mean(map_lgl(instr_files, \(f) length(f |> pluck("languages")) > 0))
  dois       <- meta |> pluck("dois") %||% list()
  access     <- meta |> pluck("access")
  file_flags <- files |> map(\(f) f |> pluck("flags")) |> unlist() |> unique()
  hard_flags <- file_flags |> intersect(c("zip_embedded_git", "zip_macos_junk", "zip_contains_test_data", "qsf_owner_id"))

  q <- quality_score(
    readme_present = rd |> pluck("present"),
    na_fields      = rd |> pluck("na_fields"),
    n_unlisted     = length(unlisted),
    n_ghost        = length(ghost),
    share_lang     = share_lang,
    has_doi        = length(dois) > 0,
    access_verified = isTRUE(access |> pluck("verified")),
    n_flags        = length(hard_flags)
  )

  instr_flags <- c(
    if (!isTRUE(rd |> pluck("present"))) "readme_missing",
    if (isTRUE((rd |> pluck("na_fields") %||% 0) > 0)) "readme_has_na",
    if (length(ghost) > 0) "readme_lists_missing_files",
    if (length(unlisted) > 0 && isTRUE(rd |> pluck("present"))) "files_not_in_readme",
    if (!isTRUE(access |> pluck("verified"))) "access_unverified",
    if (length(dois) == 0) "no_doi"
  )

  hist     <- git_history(path("instruments", rel), root)
  # Origin: frozen OSF snapshot vs. added on GitHub after the migration
  osf_path <- meta |> pluck("provenance", "osf_path")
  origin   <- if (is.null(osf_path) || is.na(osf_path)) "github" else "osf"
  added    <- meta |> pluck("provenance", "added") %||% NA_character_
  legacy <- site_cfg |> pluck("legacy", "downloads_by_acronym_min", meta |> pluck("acronym") %||% "__none__")
  tiers  <- cfg |> pluck("taxonomy", "access_tiers")
  tier   <- access |> pluck("tier")

  list(
    id = id,
    acronym = meta |> pluck("acronym") %||% NA_character_,
    title = meta |> pluck("title"),
    display = (meta |> pluck("acronym")) %||% (meta |> pluck("title")),
    section = meta |> pluck("section"),
    section_label = cfg |> pluck("taxonomy", "sections", meta |> pluck("section"), "label"),
    subsection = meta |> pluck("subsection") %||% NA_character_,
    subsection_label = cfg |> pluck("taxonomy", "subsections", meta |> pluck("subsection") %||% "__none__") %||% NA_character_,
    kind = meta |> pluck("kind"),
    kind_label = cfg |> pluck("taxonomy", "kinds", meta |> pluck("kind")),
    summary = meta |> pluck("summary") %||% NA_character_,
    tags = as.list(unlist(meta |> pluck("tags"))),
    tags_curated = isTRUE(meta |> pluck("tags_curated")),
    languages = files |> map(\(f) unlist(f |> pluck("languages"))) |> unlist() |> unique() |> sort() |> as.list(),
    platforms = files |> map_chr(\(f) f |> pluck("platform") %||% NA_character_) |> discard(is.na) |> unique() |> as.list(),
    families = files |> map_chr("family") |> unique() |> as.list(),
    survey_ready = any(map_lgl(files, \(f) f |> pluck("family") %in% c("survey", "experiment") ||
                                   (f |> pluck("family") == "archive" && !is.na(f |> pluck("platform"))))),
    access = list(
      tier = tier,
      label = tiers |> pluck(tier, "label"),
      short = tiers |> pluck(tier, "short"),
      statement = access |> pluck("statement"),
      verified = isTRUE(access |> pluck("verified")),
      source = access |> pluck("source") %||% NA_character_,
      public_repo = isTRUE(tiers |> pluck(tier, "public_repo"))
    ),
    files = files,
    n_files = length(files),
    bytes = sum(map_dbl(files, "size")),
    references = list(
      primary = as.list(unlist(meta |> pluck("references", "primary"))),
      further = as.list(unlist(meta |> pluck("references", "further")))
    ),
    dois = as.list(unlist(dois)),
    administration_html = if (is.null(meta |> pluck("administration"))) NA_character_ else
      commonmark::markdown_html(meta |> pluck("administration"), extensions = TRUE),
    readme_html = if (isTRUE(rd |> pluck("present"))) commonmark::markdown_html(rd |> pluck("text"), extensions = TRUE) else NA_character_,
    readme_files = list(listed = as.list(listed), ghost = as.list(ghost), unlisted = as.list(unlisted)),
    quality = list(
      score = q |> pluck("score"),
      level = quality_level(q |> pluck("score")),
      components = q |> pluck("components"),
      na_fields = rd |> pluck("na_fields") %||% NA_integer_,
      flags = as.list(instr_flags),
      file_flags = as.list(file_flags)
    ),
    contributors = meta |> pluck("contributors") %||% list(),
    provenance = meta |> pluck("provenance") %||% list(),
    version = meta |> pluck("version") %||% "1.0.0",
    stage = meta |> pluck("status", "stage") %||% NA_character_,
    repo_path = str_c("instruments/", rel),
    origin = origin,
    added = as.character(added),
    last_change = if (nrow(hist) > 0) max(pull(hist, date)) else as.character(added),
    n_changes = nrow(hist),
    legacy_downloads_min = legacy %||% NA_integer_,
    history = hist |> transpose()
  )
}

# -----------------------------------------------------------------------------
# Preview generation (used by 04_build_previews.R)
# -----------------------------------------------------------------------------

#' Path to the LibreOffice binary on Linux, macOS or Windows (NA if absent).
#' Order: env STAC_SOFFICE, PATH, standard install locations.
find_soffice <- function() {
  cand <- c(
    Sys.getenv("STAC_SOFFICE"),
    Sys.which("soffice"),
    Sys.which("libreoffice"),
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "C:/Program Files/LibreOffice/program/soffice.exe",
    "C:/Program Files (x86)/LibreOffice/program/soffice.exe"
  ) |> unname()
  hit <- cand |> keep(\(p) nzchar(p) && file_exists(p))
  if (length(hit) == 0) NA_character_ else hit[[1]]
}

#' TRUE when mdbtools (needed for MediaLab .que previews) is on the PATH.
has_mdbtools <- function() nzchar(Sys.which("mdb-tables")) && nzchar(Sys.which("mdb-export"))

#' Convert office files to PDF with LibreOffice in one batch per folder.
#' Output is renamed to "<original name>.pdf" so KDOCS_English.docx and
#' KDOCS_English.pdf never collide.
convert_office_batch <- function(sources, out_dir) {
  if (length(sources) == 0) return(character())
  soffice <- find_soffice()
  if (is.na(soffice)) { warning("LibreOffice (soffice) not found; skipping PDF previews. Set STAC_SOFFICE to its path."); return(character()) }
  tmp <- path_temp(str_c("lo-", digest::digest(sources)))
  dir_create(tmp)
  profile <- str_c("-env:UserInstallation=file://", path_temp("lo-profile"))
  # R exports LD_LIBRARY_PATH=/usr/lib/R/lib:...; LibreOffice then loads the
  # wrong shared libraries and exits with 127. Unset it for this call only.
  old_ld <- Sys.getenv("LD_LIBRARY_PATH")
  Sys.unsetenv("LD_LIBRARY_PATH")
  on.exit(Sys.setenv(LD_LIBRARY_PATH = old_ld), add = TRUE)
  # Files sharing a stem (SRIS_English.doc + SRIS_English.docx) would overwrite
  # each other in one batch, so run one batch per duplicate "round".
  stems  <- path_ext_remove(path_file(sources))
  rounds <- stats::ave(seq_along(stems), stems, FUN = seq_along)
  sources |>
    split(rounds) |>
    iwalk(\(batch, r) run_cmd(soffice, c(profile, "--headless", "--convert-to", "pdf",
                                         "--outdir", path(tmp, r), path_abs(batch))))
  tibble(src = sources, r = rounds) |>
    pmap_chr(\(src, r) {
      produced <- path(tmp, r, str_c(path_ext_remove(path_file(src)), ".pdf"))
      target   <- path(out_dir, str_c(path_file(src), ".pdf"))
      if (!file_exists(produced)) return(NA_character_)
      dir_create(out_dir)
      file_move(produced, target)
      as.character(target)
    })
}

#' Items preview from a parsed survey (qsf / que / lss).
items_preview <- function(parsed, kind, file_name) {
  items <- parsed |> pluck("items")
  list(
    kind = kind,
    file = file_name,
    ok = isTRUE(parsed |> pluck("ok")),
    meta = parsed[setdiff(names(parsed), c("items", "flags", "ok"))],
    flags = as.list(parsed |> pluck("flags") %||% character()),
    items = if (is.null(items) || nrow(items) == 0) list() else items |> transpose()
  )
}

#' LimeSurvey .lss / .lsq / .lsg: question texts from the XML structure.
inspect_lss <- function(lss_path) {
  doc <- tryCatch(xml2::read_xml(lss_path), error = function(e) NULL)
  if (is.null(doc)) return(list(ok = FALSE, flags = "lss_unreadable"))
  rows <- xml2::xml_find_all(doc, "//questions/rows/row")
  get <- function(node, tag) xml2::xml_text(xml2::xml_find_first(node, tag))
  items <- rows |>
    map(\(r) tibble(qid = get(r, "qid"), tag = get(r, "title"), type = get(r, "type"),
                    text = strip_html(get(r, "question") %||% ""), labels = list(character()))) |>
    list_rbind()
  list(ok = TRUE, n_items = nrow(items), items = items, flags = character(),
       survey_name = get(doc, "//surveys_languagesettings/rows/row/surveyls_title"))
}

#' Zip listing preview (folders collapsed client-side).
zip_preview <- function(zip_path, file_name) {
  z <- inspect_zip(zip_path)
  list(
    kind = "zip-tree",
    file = file_name,
    ok = isTRUE(z |> pluck("ok")),
    meta = list(n_entries = z |> pluck("n_entries"), content_bytes = z |> pluck("content_bytes"),
                junk_bytes = z |> pluck("junk_bytes")),
    flags = as.list(z |> pluck("flags") %||% character()),
    entries = (z |> pluck("entries")) |>
      (\(e) if (is.null(e) || nrow(e) == 0) list() else
        e |> mutate(junk = macosx | git) |> select(path, size, is_dir, junk, testdata) |> transpose())()
  )
}

#' First rows of a CSV/TSV as a table preview.
table_preview <- function(path_, file_name, n = 200) {
  delim <- if (file_ext_lower(path_) == "tsv") "\t" else ","
  d <- tryCatch(read_delim(path_, delim = delim, n_max = n, col_types = cols(.default = col_character()),
                           show_col_types = FALSE, progress = FALSE), error = function(e) NULL)
  if (is.null(d)) return(list(kind = "table", file = file_name, ok = FALSE, flags = list("table_unreadable")))
  list(kind = "table", file = file_name, ok = TRUE, meta = list(n_rows_shown = nrow(d)),
       flags = list(), table = list(columns = names(d), rows = d |> as.list() |> transpose() |> map(unname)))
}

#' Atom feed of new and recently changed instruments (site/feed.xml), so
#' researchers can follow growth after the OSF archive was frozen.
write_atom_feed <- function(instruments, pages_url, file, n = 30) {
  esc_xml <- function(x) x |> str_replace_all("&", "&amp;") |> str_replace_all("<", "&lt;") |> str_replace_all(">", "&gt;")
  entries <- instruments |>
    map(\(i) tibble(
      id = i |> pluck("id"), display = i |> pluck("display"), title = i |> pluck("title"),
      origin = i |> pluck("origin"),
      date = i |> pluck("last_change") %||% NA_character_,
      added = i |> pluck("added") %||% NA_character_,
      n_changes = i |> pluck("n_changes") %||% 0L,
      summary = i |> pluck("summary") %||% ""
    )) |>
    list_rbind() |>
    # Legacy instruments enter the feed only after a change beyond the migration commit
    filter(!is.na(date), origin == "github" | n_changes > 1) |>
    arrange(desc(date)) |>
    slice_head(n = n)
  updated <- if (nrow(entries) > 0) max(pull(entries, date)) else format(Sys.Date())
  items <- entries |>
    mutate(
      verb = if_else(origin == "github" & !is.na(added) & added == date, "New", "Updated"),
      link = str_c(pages_url, "#/instrument/", id)
    ) |>
    glue::glue_data(
      "  <entry>\n    <title>{verb}: {esc_xml(display)} ({esc_xml(title)})</title>\n",
      "    <link href=\"{link}\"/>\n    <id>{link}</id>\n    <updated>{date}T00:00:00Z</updated>\n",
      "    <summary>{esc_xml(str_trunc(summary, 300))}</summary>\n  </entry>"
    )
  xml <- c(
    "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
    "<feed xmlns=\"http://www.w3.org/2005/Atom\">",
    "  <title>STAC: new and updated instruments</title>",
    glue("  <link href=\"{pages_url}\"/>"),
    glue("  <id>{pages_url}</id>"),
    glue("  <updated>{updated}T00:00:00Z</updated>"),
    items,
    "</feed>"
  )
  write_lines(xml, file)
}
