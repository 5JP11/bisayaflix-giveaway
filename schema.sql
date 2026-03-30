-- Create the registrations table
CREATE TABLE registrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  screenshot_url text,
  created_at timestamp with time zone DEFAULT now()
);

-- Note: You should also go to "Storage" in the sidebar, 
-- create a bucket named "screenshots", and make it Public.
