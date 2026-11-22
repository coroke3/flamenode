/**
 * SEC-785 CI adapter: the root test:unit glob only discovers src/**/*.test.mjs.
 * Run the canonical Worker diagnostic suite once without duplicating assertions.
 */
import "../../../workers/shared/safeLog.test.mjs";
