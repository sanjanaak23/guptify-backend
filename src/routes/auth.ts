import express from 'express';
import { supabase } from '../lib/supabase'; // Import the already configured supabase client

const router = express.Router();

// Sign up
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ user: data.user });
});

// Sign in
router.post('/signin', async (req, res) => {
  const { email, password } = req.body;
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ user: data.user, session: data.session });
});

// Sign out
router.post('/signout', async (_req, res) => {
  const { error } = await supabase.auth.signOut();
  
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ message: 'Signed out successfully' });
});

export default router;