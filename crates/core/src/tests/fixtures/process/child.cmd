@echo off
echo cmd_started=%DATE% %TIME%
set KS_DESCENDANT_WORKER=1
"%KS_DESCENDANT_EXE%" tests::process_tests::windows_descendant_worker --exact --ignored --nocapture --test-threads=1
