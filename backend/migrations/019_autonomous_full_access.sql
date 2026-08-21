ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_policy_check;
ALTER TABLE operations ADD CONSTRAINT operations_policy_check
    CHECK (policy IN ('approval_required','explain_only','unrestricted_approval','autonomous_full_access'));

ALTER TABLE operations DROP CONSTRAINT IF EXISTS operations_risk_check;
ALTER TABLE operations ADD CONSTRAINT operations_risk_check
    CHECK (risk IN ('low','medium') OR (risk='high' AND policy IN ('unrestricted_approval','autonomous_full_access')));
