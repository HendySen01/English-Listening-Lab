-- Isolated schema only. Do not apply this file to public.
-- statement
CREATE OR REPLACE FUNCTION lab_phase_h.study_session_same_user() RETURNS trigger AS $$
BEGIN
  IF NEW."lessonId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM lab_phase_h."DailyLesson" WHERE "id" = NEW."lessonId" AND "userId" = NEW."userId"
  ) THEN
    RAISE EXCEPTION 'cross-user-link';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql
-- statement
DROP TRIGGER IF EXISTS study_session_same_user_insert ON lab_phase_h."StudySession"
-- statement
CREATE TRIGGER study_session_same_user_insert
BEFORE INSERT ON lab_phase_h."StudySession"
FOR EACH ROW EXECUTE FUNCTION lab_phase_h.study_session_same_user()
-- statement
DROP TRIGGER IF EXISTS study_session_same_user_update ON lab_phase_h."StudySession"
-- statement
CREATE TRIGGER study_session_same_user_update
BEFORE UPDATE ON lab_phase_h."StudySession"
FOR EACH ROW EXECUTE FUNCTION lab_phase_h.study_session_same_user()
