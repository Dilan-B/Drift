-- Streak tracking on profiles for server-side push notifications.
-- Run after the base schema in the Supabase SQL editor.

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
  IF NEW.status != 'completed' THEN RETURN NEW; END IF;

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
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed')
  EXECUTE FUNCTION update_streak_on_task_complete();

-- Also fire on insert for tasks that are inserted already completed
DROP TRIGGER IF EXISTS trg_update_streak_insert ON tasks;
CREATE TRIGGER trg_update_streak_insert
  AFTER INSERT ON tasks
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION update_streak_on_task_complete();

-- Backfill current streaks from existing task history
-- (Run once, then triggers handle it going forward)
WITH daily_completions AS (
  SELECT user_id, DATE(completed_at) AS d
  FROM tasks
  WHERE status = 'completed' AND completed_at IS NOT NULL
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
