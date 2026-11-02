# =============================================================================
# 01_migrate_osf_archive.R  (one-time)
# -----------------------------------------------------------------------------
# Copies the unpacked OSF storage archive (osfstorage-archive.zip of project
# 4s9p6) into the instruments/ tree of this repository.
#
#   * Instrument FILES are copied 1:1 (byte-identical, names unchanged).
#     Moderators decided not to alter authors' files during migration;
#     problems are flagged in the catalog instead.
#   * Only FOLDER names are normalised to URL-safe slugs
#     ("K-DOCS – Kaufman Domains ..." -> "k-docs-kaufman-domains-...").
#   * migration/osf_path_map.csv records old OSF path -> new repo path with
#     SHA-256 per file, so every file can be traced back to OSF.
#
# Usage: Rscript scripts/01_migrate_osf_archive.R <path/to/unpacked/archive>
# =============================================================================

source("scripts/00_helpers.R")

args <- commandArgs(trailingOnly = TRUE)
src  <- if (length(args) >= 1) path_abs(args[[1]]) else stop("Pass the unpacked OSF archive folder.")
root <- stac_root()
cfg  <- read_stac_config(root)

# OSF top-level folder name -> section slug
section_lookup <- cfg |>
  pluck("taxonomy", "sections") |>
  imap(\(s, id) tibble(osf = s |> pluck("osf"), section = id)) |>
  list_rbind()

# --- 1. Discover measure folders in the OSF archive --------------------------
osf_dirs <- dir_ls(src, recurse = TRUE, type = "directory") |>
  keep(\(d) {
    files <- dir_ls(d, type = "file")
    subdirs <- dir_ls(d, type = "directory")
    length(files) > 0 && (length(subdirs) == 0 || any(path_file(files) == "README.md"))
  }) |>
  unname()

log_step("Found {length(osf_dirs)} measure folders in the OSF archive.")

# --- 2. Map OSF path -> repository path -----------------------------------
dir_map <- tibble(osf_dir = osf_dirs) |>
  mutate(
    osf_rel = path_rel(osf_dir, src) |> as.character(),
    parts   = path_split(osf_rel),
    osf_top = map_chr(parts, 1)
  ) |>
  left_join(section_lookup, by = c("osf_top" = "osf")) |>
  mutate(
    rest     = map(parts, \(p) p[-1] |> slugify()),
    repo_rel = map2_chr(section, rest, \(s, r) path("instruments", s, path_join(r)) |> as.character())
  )

stopifnot(
  "Unknown OSF section folder" = !anyNA(pull(dir_map, section)),
  "Slug collision between instrument folders" = !anyDuplicated(pull(dir_map, repo_rel))
)

# --- 3. Copy files 1:1 and build the file-level map --------------------------
file_map <- dir_map |>
  select(osf_dir, osf_rel, repo_rel) |>
  pmap(\(osf_dir, osf_rel, repo_rel) {
    target <- path(root, repo_rel)
    dir_create(target)
    files <- dir_ls(osf_dir, type = "file")
    walk(files, \(f) file_copy(f, path(target, path_file(f)), overwrite = TRUE))
    tibble(
      osf_path  = path(osf_rel, path_file(files)) |> as.character(),
      repo_path = path(repo_rel, path_file(files)) |> as.character(),
      bytes     = as.numeric(file_size(files)),
      sha256    = map_chr(files, file_sha256)
    )
  }) |>
  list_rbind()

# Verify byte identity after copying (cheap insurance for a 1:1 migration)
copied_ok <- file_map |>
  mutate(sha_copy = map_chr(path(root, repo_path), file_sha256)) |>
  summarise(ok = all(sha_copy == sha256)) |>
  pull(ok)
stopifnot("Copied files differ from the OSF originals" = copied_ok)

# --- 4. Root-level OSF files -------------------------------------------------
root_files <- tribble(
  ~osf_name,                                ~target,
  "STAC Paper - Kenett et al 2026 PTAD.pdf", "docs/paper/Kenett_Silvia_Benedek_2026_PTAD_STAC.pdf",
  "Structure.png",                           "docs/figures/osf_structure_2026.png",
  "README_Template.md",                      "templates/README_Template.md"
) |>
  filter(file_exists(path(src, osf_name)))

root_files |>
  pwalk(\(osf_name, target) {
    dir_create(path(root, path_dir(target)))
    file_copy(path(src, osf_name), path(root, target), overwrite = TRUE)
  })

# --- 5. Write migration records ----------------------------------------------
dir_create(path(root, "migration"))
write_csv(file_map, path(root, "migration", "osf_path_map.csv"))
dir_map |>
  select(osf_rel, repo_rel) |>
  write_csv(path(root, "migration", "osf_folder_map.csv"))

log_step("Copied {nrow(file_map)} files ({round(sum(pull(file_map, bytes)) / 1e6, 1)} MB) into instruments/.")
log_step("Maps written to migration/osf_path_map.csv and migration/osf_folder_map.csv.")
