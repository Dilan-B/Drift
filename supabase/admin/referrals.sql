-- Referral system: tracked referral codes with rewards for both sides.
-- Run after schema_v*.sql files in the Supabase SQL editor.

-- 1. Add referral_code column to profiles (unique per user)
--
-- bonus_minutes is created here because apply_referral_code (step 5) writes to
-- it. It was previously assumed to already exist on profiles; it does not —
-- nothing else in the schema or the client creates it, so the function failed
-- at runtime on the first redemption while the table and trigger installed
-- cleanly, making it look like the migration had worked.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS bonus_minutes integer NOT NULL DEFAULT 0;

-- 2. Generate a referral code for every existing user that doesn't have one
UPDATE profiles
SET referral_code = UPPER(SUBSTR(MD5(id::text || EXTRACT(EPOCH FROM NOW())::text), 1, 6))
WHERE referral_code IS NULL;

-- 3. Auto-generate referral code on new sign-ups
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := UPPER(SUBSTR(MD5(NEW.id::text || EXTRACT(EPOCH FROM NOW())::text), 1, 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_referral_code ON profiles;
CREATE TRIGGER trg_generate_referral_code
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION generate_referral_code();

-- 4. Referral events table (tracks each successful referral)
CREATE TABLE IF NOT EXISTS referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id),
  referred_id uuid NOT NULL REFERENCES auth.users(id),
  referral_code text NOT NULL,
  reward_granted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(referred_id)
);

ALTER TABLE referral_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own referral events"
  ON referral_events FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

-- 5. Function to apply a referral code (called from the client after signup)
CREATE OR REPLACE FUNCTION apply_referral_code(code text)
RETURNS jsonb AS $$
DECLARE
  v_referrer_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  -- Check if user already used a referral code
  IF EXISTS (SELECT 1 FROM referral_events WHERE referred_id = v_user_id) THEN
    RETURN jsonb_build_object('error', 'already_referred');
  END IF;

  -- Can't refer yourself
  SELECT id INTO v_referrer_id FROM profiles WHERE referral_code = UPPER(code);
  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_code');
  END IF;
  IF v_referrer_id = v_user_id THEN
    RETURN jsonb_build_object('error', 'self_referral');
  END IF;

  -- Record the referral
  INSERT INTO referral_events (referrer_id, referred_id, referral_code)
  VALUES (v_referrer_id, v_user_id, UPPER(code));

  -- Mark who referred this user
  UPDATE profiles SET referred_by = v_referrer_id WHERE id = v_user_id;

  -- Grant bonus screen time to both (15 minutes each)
  UPDATE profiles
  SET bonus_minutes = COALESCE(bonus_minutes, 0) + 15
  WHERE id IN (v_referrer_id, v_user_id);

  -- Mark reward as granted
  UPDATE referral_events SET reward_granted = true
  WHERE referred_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'bonus_minutes', 15);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
