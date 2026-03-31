-- Create the registrations table
CREATE TABLE registrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  screenshot_url text,
  created_at timestamp with time zone DEFAULT now()
);

-- Create the winners table for persistent record keeping
CREATE TABLE winners (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  winner_name text NOT NULL,
  prize_won text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Create the giveaway_state table for real-time synchronization
CREATE TABLE giveaway_state (
  id integer PRIMARY KEY,
  is_spinning boolean DEFAULT false,
  current_prize text DEFAULT 'None',
  winner_name text DEFAULT 'None',
  last_updated timestamp with time zone DEFAULT now()
);

-- Note: You should also go to "Storage" in the sidebar, 
-- create a bucket named "screenshots", and make it Public.
