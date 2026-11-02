# =============================================================================
# 02_bootstrap_metadata.R  (one-time, re-runnable)
# -----------------------------------------------------------------------------
# Creates a DRAFT stac.yml for every instrument folder from its README.md and
# the actual file inventory. Existing stac.yml files are never overwritten
# unless --force is given, so curated metadata is safe.
#
# What is inferred (and therefore marked as unverified):
#   * acronym / title from the OSF folder name
#   * language, platform and role of each file from its name
#   * per-file citations and references from the README "Citation" section
#   * access tier from the README "Licensing" sentence
#   * tag suggestions from config/taxonomy.yml (tags_curated: false)
#
# Usage: Rscript scripts/02_bootstrap_metadata.R [--force]
# =============================================================================

source("scripts/00_helpers.R")

force <- "--force" %in% commandArgs(trailingOnly = TRUE)
root  <- stac_root()
cfg   <- read_stac_config(root)
folder_map <- read_csv(path(root, "migration", "osf_folder_map.csv"), show_col_types = FALSE)

# Boilerplate sentence of the OSF template that carries no information
boilerplate_rx <- "^This folder contains files related to [^.]+\\.\\s*"

#' Map the README licensing sentence to an access tier.
licensing_to_tier <- function(statement) {
  s <- str_to_lower(statement %||% "")
  case_when(
    str_detect(s, "permission") & str_detect(s, "commercial") ~ "commercial-with-permission",
    str_detect(s, "academic") & str_detect(s, "non-?commercial") ~ "academic-noncommercial",
    str_detect(s, "research (purposes )?only") ~ "research-only",
    str_detect(s, "cc[- ]by|public domain|any purpose") ~ "open",
    .default = "academic-noncommercial"
  )
}

#' Build the draft metadata list for one instrument folder.
bootstrap_one <- function(dir) {
  pp     <- path_parts(dir, root)
  osf    <- folder_map |> filter(repo_rel == path("instruments", pp |> pluck("rel"))) |> pull(osf_rel)
  osf    <- if (length(osf) == 0) NA_character_ else osf[[1]]
  names_ <- split_osf_name(if (is.na(osf)) pp |> pluck("slug") else path_file(osf))
  rd     <- parse_readme(find_readme(dir))
  secs   <- rd |> pluck("sections")

  overview <- secs |> pluck("overview") %||% NA_character_
  overview <- if (is_na_body(overview)) NA_character_ else overview |> md_unescape() |> str_remove(boilerplate_rx) |> str_squish()
  overview <- if (!is.na(overview) && overview == "") NA_character_ else overview

  admin <- secs |> pluck("administration and scoring") %||% NA_character_
  admin <- if (is_na_body(admin)) NA_character_ else md_unescape(admin)

  lic_body <- secs |> pluck("licensing") %||% NA_character_
  lic_stmt <- if (is_na_body(lic_body)) NA_character_ else lic_body |> md_unescape() |>
    str_remove("\\s*Refer to the project's Wiki.*$") |> str_squish()

  cites <- rd |> pluck("citations")
  files <- instrument_files(dir) |>
    map(\(f) {
      nm  <- path_file(f)
      ext <- file_ext_lower(nm)
      langs <- detect_languages(nm, cfg)
      cit <- cites |> pluck(nm) %||% NA_character_
      list(
        path = nm,
        format = ext,
        languages = as.list(langs),
        platform = detect_platform(nm, cfg),
        role = detect_role(nm, cfg),
        citation = cit
      )
    })

  file_cites <- files |> map_chr(\(x) x |> pluck("citation")) |> discard(is.na) |> unique()
  refs_admin <- extract_references(admin)
  primary    <- unique(file_cites)
  further    <- setdiff(refs_admin, primary)
  # Tag text: title, overview and non-reference admin paragraphs only. Journal
  # names (e.g. "Psychology of Aesthetics, Creativity, and the Arts") would
  # otherwise tag every creativity scale as "aesthetics".
  admin_prose <- if (is.na(admin)) character() else admin |> str_split("\\n\\s*\\n") |> pluck(1) |>
    discard(\(p) str_detect(p, "\\((19|20)\\d{2}[a-z]?\\)"))
  all_text   <- c(names_ |> pluck("title"), overview, admin_prose) |>
    discard(is.na) |>
    str_c(collapse = " ") |>
    str_remove_all("(?i)psychology of aesthetics,? creativity,? and the arts")

  kind <- case_when(
    identical(pp |> pluck("subsection"), "methods-and-scoring") ~ "method",
    str_detect(pp |> pluck("rel"), "/tasks/") ~ "task",
    .default = "scale"
  )

  list(
    schema_version = 1L,
    id = pp |> pluck("slug"),
    acronym = names_ |> pluck("acronym"),
    title = names_ |> pluck("title"),
    section = pp |> pluck("section"),
    subsection = pp |> pluck("subsection"),
    kind = kind,
    summary = overview,
    tags = as.list(suggest_tags(all_text, cfg)),
    tags_curated = FALSE,
    access = list(
      tier = licensing_to_tier(lic_stmt),
      statement = lic_stmt %||% "Free to use for academic and non-commercial purposes (STAC inclusion criterion, Kenett et al., 2026).",
      source = if (is.na(lic_stmt)) "stac-inclusion-criterion" else "readme",
      verified = FALSE
    ),
    files = files,
    references = list(primary = as.list(primary), further = as.list(further)),
    dois = as.list(extract_dois(c(primary, further, admin))),
    administration = admin,
    contributors = list(),
    status = list(
      stage = "migrated-draft",
      readme_present = rd |> pluck("present"),
      readme_na_fields = rd |> pluck("na_fields")
    ),
    provenance = list(
      osf_project = "https://osf.io/4s9p6",
      osf_path = osf,
      migrated = format(Sys.Date())
    ),
    version = "1.0.0"
  )
}

dirs <- find_instrument_dirs(root)
todo <- if (force) dirs else dirs |> discard(\(d) file_exists(path(d, "stac.yml")))
log_step("{length(dirs)} instrument folders, {length(todo)} need a stac.yml.")

todo |>
  walk(\(d) {
    meta <- bootstrap_one(d)
    write_stac_yml(meta, d, root)
  })

log_step("Draft stac.yml written for {length(todo)} instruments. Curate before publishing.")
