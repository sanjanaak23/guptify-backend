import express, { Request, Response, NextFunction } from 'express';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

const router = express.Router();

// Extend Express Request to include `user`
interface AuthenticatedRequest extends Request {
  user?: User;
}

// Middleware to check authentication
const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  req.user = user;
  next();
};

// Get all folders for user
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ folders: data });
});

// Create a new folder
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const { name, parent_id } = req.body;

  const { data, error } = await supabase
    .from('folders')
    .insert([
      { 
        name,
        parent_id: parent_id || null,
        user_id: req.user.id 
      }
    ])
    .select();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ folder: data[0] });
});

// Update a folder
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;
  const { name } = req.body;

  const { data, error } = await supabase
    .from('folders')
    .update({ name })
    .eq('id', id)
    .eq('user_id', req.user.id)
    .select();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ folder: data[0] });
});

// Delete a folder (soft delete)
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  const { id } = req.params;

  const { error } = await supabase
    .from('folders')
    .update({ is_deleted: true })
    .eq('id', id)
    .eq('user_id', req.user.id);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ message: 'Folder moved to trash' });
});

export default router;
