NAMES="bugfix_off_by_one refactor_rename_variable refactor_strings_to_enum impl_event_emitter impl_rest_router patch_add_logging patch_js_to_typescript understand_merge_sort_complexity understand_timed_cache search_find_callers cross_fix_circular_import errh_retry_backoff"

for s in $NAMES; do
  COTECT_EVAL_ENDPOINT=http://server.local:8080/v1 \
  COTECT_EVAL_MODEL=gemma-4-26b-a4b \
  COTECT_EVAL_FORMAT=gemma \
  COTECT_EVAL_FILTER=$s \
  cargo test -p cotect eval_suite -- --ignored --nocapture 2>&1 | tail -20
  echo "---"
done
