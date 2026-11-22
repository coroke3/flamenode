/**
 * SEC-785 CI adapter: the root test:unit runner discovers tests within the src directory.
 * Run the canonical Worker diagnostic suite once without duplicating assertions.
 */
import "../../../workers/shared/safeLog.test.mjs";
