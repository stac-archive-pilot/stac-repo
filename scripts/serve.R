# =============================================================================
# serve.R
# -----------------------------------------------------------------------------
# Serves site/ on http://localhost:8000 so the catalog can load its data.
# (Opening site/index.html by double-click does not work: browsers block
# data requests from file:// pages.)
#
# Usage: Rscript scripts/serve.R [port]
# Needs httpuv >= 1.6.6; otherwise use:  cd site && python -m http.server 8000
# =============================================================================

port <- as.integer(commandArgs(trailingOnly = TRUE)[1])
if (is.na(port)) port <- 8000L
if (!file.exists("site/index.html")) stop("Run from the repository root.", call. = FALSE)
if (!file.exists("site/data/catalog.json")) stop("site/data/catalog.json missing: run Rscript scripts/run_build.R first.", call. = FALSE)

if (requireNamespace("httpuv", quietly = TRUE) && utils::packageVersion("httpuv") >= "1.6.6") {
  cat("Serving site/ at http://localhost:", port, "  (stop with Ctrl+C / Esc)\n", sep = "")
  httpuv::runStaticServer(dir = "site", host = "127.0.0.1", port = port, browse = interactive())
} else {
  stop("httpuv >= 1.6.6 not installed. Either install.packages(\"httpuv\") or run:\n",
       "  cd site && python -m http.server ", port, call. = FALSE)
}
