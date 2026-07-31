-- Streak tracking on profiles for server-side push notifications.
-- Run after the base schema in the Supabase SQL editor.
--
-- COLUMN NAMES: tasks completion is `done boolean` + `completed_at timestamptz`
-- — see completeTaskRow() in sync.js, which writes {done: true, completed_at}.
-- An earlier version of this file keyed off a `status = 'completed'` text
-- column that the app never writes and that may not exist at all. That fails
-- loudly (CREATE TRIGGER ... WHEN references a missing column) or, worse,
-- silently: triggers install against an unused column and every streak stays
-- at 0 forever. Keep these predicates in sync with sync.js.

-- Add streak columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS current_streak integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_task_date date;

-- Function to update streak when a task is completed
CREATE OR REPLACE FUNCTION update_streak_on_task_complete()
RETURNS TRIGGER AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_last date;
  v_current integer;
  v_longest integer;
BEGIN
  IF NEW.done IS NOT TRUE THEN RETURN NEW; END IF;

  SELECT last_task_date, current_streak, longest_streak
  INTO v_last, v_current, v_longest
  FROM profiles WHERE id = NEW.user_id;

  IF v_last IS NULL OR v_last < v_today - 1 THEN
    -- Streak broken or first task ever
    v_current := 1;
  ELSIF v_last = v_today - 1 THEN
    -- Continuing streak from yesterday
    v_current := COALESCE(v_current, 0) + 1;
  ELSIF v_last = v_today THEN
    -- Already completed a task today, streak unchanged
    NULL;
  END IF;

  v_longest := GREATEST(COALESCE(v_longest, 0), v_current);

  UPDATE profiles
  SET current_streak = v_current,
      longest_streak = v_longest,
      last_task_date = v_today
  WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_streak ON tasks;
CREATE TRIGGER trg_update_streak
  AFTER UPDATE ON tasks
  FOR EACH ROW
  WHEN (OLD.done IS DISTINCT FROM NEW.done AND NEW.done IS TRUE)
  EXECUTE FUNCTION update_streak_on_task_complete();

-- Also fire on insert for tasks that are inserted already completed
DROP TRIGGER IF EXISTS trg_update_streak_insert ON tasks;
CREATE TRIGGER trg_update_streak_insert
  AFTER INSERT ON tasks
  FOR EACH ROW
  WHEN (NEW.done IS TRUE)
  EXECUTE FUNCTION update_streak_on_task_complete();

-- Backfill current streaks from existing task history.
-- Safe to re-run: it recomputes from the tasks table rather than incrementing,
-- so it converges on the same values. Soft-deleted tasks are excluded to match
-- fetchTasks() in sync.js, which filters on deleted_at IS NULL — counting them
-- would inflate streaks with days the user has since removed.
WITH daily_completions AS (
  SELECT user_id, DATE(completed_at) AS d
  FROM tasks
  WHERE done IS TRUE
    AND completed_at IS NOT NULL
    AND deleted_at IS NULL
  GROUP BY user_id, DATE(completed_at)
),
streaks AS (
  SELECT user_id,
    d,
    d - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d))::int AS grp
  FROM daily_completions
),
streak_lengths AS (
  SELECT user_id, grp, COUNT(*) AS len, MAX(d) AS last_day
  FROM streaks
  GROUP BY user_id, grp
),
user_streaks AS (
  SELECT user_id,
    MAX(len) AS longest,
    (SELECT len FROM streak_lengths s2
     WHERE s2.user_id = sl.user_id
     ORDER BY s2.last_day DESC LIMIT 1) AS current_candidate,
    (SELECT last_day FROM streak_lengths s3
     WHERE s3.user_id = sl.user_id
     ORDER BY s3.last_day DESC LIMIT 1) AS last_day
  FROM streak_lengths sl
  GROUP BY user_id
)
UPDATE profiles p
SET current_streak = CASE
      WHEN us.last_day >= CURRENT_DATE - 1 THEN us.current_candidate
      ELSE 0
    END,
    longest_streak = us.longest,
    last_task_date = us.last_day
FROM user_streaks us
WHERE p.id = us.user_id;
