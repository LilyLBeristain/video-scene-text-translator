# Session: Replace googletrans with deep-translator — 2026-04-07

## Completed
- Researched 5 translation libraries (googletrans, deep-translator, argos-translate, translatepy, Google Cloud Translate)
- Replaced `googletrans-py` with `deep-translator` in selector.py, config, YAML files, and requirements
- Implemented `GoogleTranslator` with automatic `MyMemoryTranslator` fallback — both free, no API key
- Wrote 4 translation tests: success, blank-text short-circuit, Google→MyMemory fallback, both-fail-returns-source
- Fixed lint (SIM102 nested-if simplification in `_init_translator`)
- Committed (`993f525`) and pushed to `feat/anytext2-integration`

## Current State
- Branch `feat/anytext2-integration` is 14 commits ahead of master
- All 9 AnyText2 plan steps + translation fix complete
- 141 tests passing (4 PaddleOCR failures are pre-existing `wordfreq` not installed), lint clean
- `deep-translator` installed in conda env `vc_final`

## Next Steps
1. Merge `feat/anytext2-integration` to master
2. Investigate CoTracker OOM on 1080p+ video — consider chunked inference or streaming pipeline
3. Test with more real videos at full resolution on a larger GPU (24GB+)
4. Stage C planning (TPM model integration) if time permits

## Decisions Made
- **deep-translator over googletrans**: googletrans reverse-engineers undocumented Google endpoints, fails silently with `NoneType` on certain inputs (GitHub #260, wontfix). deep-translator raises explicit exceptions and supports multiple free backends.
- **deep-translator over argos-translate**: argos-translate is offline but ~1-2GB deps (PyTorch + CTranslate2 + models), weaker on short text (our exact use case), and risks PyTorch version conflicts with CoTracker.
- **deep-translator over Google Cloud Translate**: Google Cloud is the gold standard but requires API key + GCP project setup — too much friction for a 3-person academic team.
- **GoogleTranslator + MyMemoryTranslator fallback**: Both free and keyless. If Google blocks requests, MyMemory provides a second chance automatically.
- **Removed googletrans entirely**: No backward compat shim — clean replacement per project conventions.

## Open Questions
- googletrans is still not uninstalled from conda env (just removed from requirements). Should we `pip uninstall googletrans-py`?
