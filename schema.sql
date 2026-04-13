-- Create the registrations table
CREATE TABLE IF NOT EXISTS registrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  screenshot_url text,
  created_at timestamp with time zone DEFAULT now()
);

-- Create the winners table for persistent record keeping
CREATE TABLE IF NOT EXISTS winners (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  winner_name text NOT NULL,
  prize_won text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Create the giveaway_state table for real-time synchronization
CREATE TABLE IF NOT EXISTS giveaway_state (
  id integer PRIMARY KEY,
  is_spinning boolean DEFAULT false,
  current_prize text DEFAULT 'None',
  winner_name text DEFAULT 'None',
  last_updated timestamp with time zone DEFAULT now()
);

-- Create the prizes table
CREATE TABLE IF NOT EXISTS prizes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now()
);

-- Note: You should also go to "Storage" in the sidebar, 
-- create a bucket named "screenshots", and make it Public.

-- EXTREMELY IMPORTANT: ENABLE REALTIME
-- You must enable Realtime for the winners and registrations tables to see the dash update live.
-- You can do this in the Dashboard (Database -> Replication) OR by running these:
-- alter publication supabase_realtime add table registrations;
-- alter publication supabase_realtime add table winners;
-- alter publication supabase_realtime add table giveaway_state;
-- alter publication supabase_realtime add table prizes;

-- Seed with initial prizes
INSERT INTO prizes (name) VALUES 
('BisayaFlix Varsity Jacket'),
('BisayaFlix Tshirt'),
('Totebags'),
('BisayaFlix Pocketfans'),
('BisayaFlix Sticker')
ON CONFLICT (name) DO NOTHING;
