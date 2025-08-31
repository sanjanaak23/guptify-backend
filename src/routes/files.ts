import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import { supabase } from '../lib/supabase';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Custom interface to extend Request with user property
interface AuthenticatedRequest extends express.Request {
  user?: any;
}

// =======================
// Middleware: Authenticate user (FIXED)
// =======================
const authenticate = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
    return undefined; // Explicit return to satisfy TypeScript
  } catch (error) {
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// =======================
// Upload file with multer (FIXED)
// =======================
router.post('/upload', authenticate, upload.single('file'), async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const file = req.file;
    const folderId = req.body.folderId || null;
    const fileExt = path.extname(file.originalname);
    const fileName = `${Date.now()}${fileExt}`;
    const filePath = `uploads/${req.user!.id}/${fileName}`;

    // Upload file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('files')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      return res.status(400).json({ error: uploadError.message });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('files')
      .getPublicUrl(filePath);

    // Save file metadata to database
    const { data, error: dbError } = await supabase
      .from('files')
      .insert([
        { 
          name: file.originalname, 
          size: file.size, 
          type: file.mimetype, 
          path: filePath,
          user_id: req.user!.id,
          folder_id: folderId,
          public_url: urlData.publicUrl
        }
      ])
      .select();

    if (dbError) {
      return res.status(400).json({ error: dbError.message });
    }

    return res.json({ file: data[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to upload file' });
  }
});

// =======================
// Get user files (with pagination and folder filtering) (FIXED)
// =======================
router.get('/', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { page = 1, limit = 20, folder_id } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('files')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user!.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    // Filter by folder if specified
    if (folder_id) {
      if (folder_id === 'root') {
        query = query.is('folder_id', null);
      } else {
        query = query.eq('folder_id', folder_id);
      }
    }

    // Add pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data, error: queryError, count } = await query;

    if (queryError) {
      return res.status(400).json({ error: queryError.message });
    }

    return res.json({ 
      files: data, 
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// =======================
// Upload file metadata only (FIXED)
// =======================
router.post('/', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { name, size, type, path: filePath, folder_id } = req.body;
    
    const { data, error } = await supabase
      .from('files')
      .insert([{ 
        name, 
        size, 
        type, 
        path: filePath, 
        folder_id: folder_id || null,
        user_id: req.user!.id 
      }])
      .select();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ file: data[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create file metadata' });
  }
});

// =======================
// Search files (UPDATED with filters)
// =======================
router.get('/search', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { query, type, sizeMin, sizeMax, dateFrom, dateTo } = req.query;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Search query required' });
    }

    // Base query
    let queryBuilder = supabase
      .from('files')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('is_deleted', false)
      .ilike('name', `%${query}%`);

    // Filter by file type
    if (type) {
      if (type === 'image') {
        queryBuilder = queryBuilder.like('type', 'image/%');
      } else if (type === 'pdf') {
        queryBuilder = queryBuilder.eq('type', 'application/pdf');
      } else if (type === 'document') {
        queryBuilder = queryBuilder.or(
          'type.ilike.%word%,type.ilike.%excel%,type.ilike.%powerpoint%,type.ilike.%officedocument%'
        );
      } else if (type === 'video') {
        queryBuilder = queryBuilder.like('type', 'video/%');
      } else if (type === 'audio') {
        queryBuilder = queryBuilder.like('type', 'audio/%');
      }
    }

    // Filter by file size (MB → bytes)
    if (sizeMin) {
      const minBytes = parseInt(sizeMin as string) * 1024 * 1024;
      queryBuilder = queryBuilder.gte('size', minBytes);
    }
    if (sizeMax) {
      const maxBytes = parseInt(sizeMax as string) * 1024 * 1024;
      queryBuilder = queryBuilder.lte('size', maxBytes);
    }

    // Filter by creation date
    if (dateFrom) {
      queryBuilder = queryBuilder.gte('created_at', dateFrom as string);
    }
    if (dateTo) {
      queryBuilder = queryBuilder.lte('created_at', dateTo as string);
    }

    // Order by newest first
    queryBuilder = queryBuilder.order('created_at', { ascending: false });

    const { data, error } = await queryBuilder;

    if (error) return res.status(400).json({ error: error.message });

    res.json({ files: data });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// =======================
// Get files in trash (FIXED)
// =======================
router.get('/trash', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('is_deleted', true)
      .order('updated_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ files: data });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch trash' });
  }
});

// =======================
// Move file to trash (soft delete) (FIXED)
// =======================
router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('files')
      .update({ is_deleted: true })
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .select();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ file: data[0], message: 'File moved to trash' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to move file to trash' });
  }
});

// =======================
// Restore file from trash (FIXED)
// =======================
router.post('/:id/restore', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('files')
      .update({ is_deleted: false })
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .select();

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ file: data[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to restore file' });
  }
});

// =======================
// Permanently delete file (FIXED)
// =======================
router.delete('/:id/permanent', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    
    // Get file details
    const { data: fileData, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (fileError || !fileData) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('files')
      .remove([fileData.path]);

    if (storageError) {
      console.error('Error deleting from storage:', storageError);
    }

    // Delete from DB
    const { error: dbError } = await supabase
      .from('files')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user!.id);

    if (dbError) return res.status(400).json({ error: dbError.message });

    return res.json({ message: 'File permanently deleted' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete file' });
  }
});

// =======================
// Generate shareable link (FIXED)
// =======================
router.post('/:id/share', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    const { expiresIn = 3600 } = req.body;
    
    const { data: fileData, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (fileError || !fileData) {
      return res.status(404).json({ error: 'File not found' });
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('files')
      .createSignedUrl(fileData.path, expiresIn);

    if (signedUrlError) {
      return res.status(400).json({ error: signedUrlError.message });
    }

    const { data: shareData, error: shareError } = await supabase
      .from('file_shares')
      .insert([{
        file_id: id,
        created_by: req.user!.id,
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        token: crypto.randomBytes(16).toString('hex')
      }])
      .select();

    if (shareError) return res.status(400).json({ error: shareError.message });

    return res.json({ signedUrl: signedUrlData.signedUrl, share: shareData[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to generate share link' });
  }
});

// =======================
// Access file via share token (public) (FIXED)
// =======================
router.get('/shared/:token', async (req: express.Request, res: express.Response) => {
  try {
    const { token } = req.params;
    
    const { data: shareData, error: shareError } = await supabase
      .from('file_shares')
      .select('*, files(*)')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (shareError || !shareData) {
      return res.status(404).json({ error: 'Share link invalid or expired' });
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('files')
      .createSignedUrl(shareData.files.path, 60);

    if (signedUrlError) {
      return res.status(400).json({ error: signedUrlError.message });
    }

    return res.json({ file: shareData.files, downloadUrl: signedUrlData.signedUrl });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to access file' });
  }
});

// =======================
// Empty trash (FIXED)
// =======================
router.delete('/trash/empty', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    // Get all files in trash
    const { data: files, error: fetchError } = await supabase
      .from('files')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('is_deleted', true);

    if (fetchError) {
      return res.status(400).json({ error: fetchError.message });
    }

    // Delete from storage
    const pathsToDelete = files.map(file => file.path);
    if (pathsToDelete.length > 0) {
      const { error: storageError } = await supabase.storage
        .from('files')
        .remove(pathsToDelete);

      if (storageError) {
        console.error('Error deleting from storage:', storageError);
      }
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('files')
      .delete()
      .eq('user_id', req.user!.id)
      .eq('is_deleted', true);

    if (dbError) {
      return res.status(400).json({ error: dbError.message });
    }

    return res.json({ message: 'Trash emptied successfully', count: files.length });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to empty trash' });
  }
});

// =======================
// Get file preview (FIXED)
// =======================
router.get('/:id/preview', authenticate, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const { id } = req.params;
    
    // Get file details
    const { data: fileData, error: fileError } = await supabase
      .from('files')
      .select('*')
      .eq('id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (fileError || !fileData) {
      return res.status(404).json({ error: 'File not found' });
    }

    // For images, PDFs, and text files, generate a preview URL
    const { data: previewData, error: previewError } = await supabase.storage
      .from('files')
      .createSignedUrl(fileData.path, 60); // 1 minute expiry

    if (previewError) {
      return res.status(400).json({ error: previewError.message });
    }

    // Determine file type for appropriate preview handling
    const fileType = fileData.type || '';
    let previewType = 'other';
    
    if (fileType.startsWith('image/')) {
      previewType = 'image';
    } else if (fileType === 'application/pdf') {
      previewType = 'pdf';
    } else if (fileType.startsWith('text/') || 
               fileType === 'application/json' ||
               fileType === 'application/javascript') {
      previewType = 'text';
    }

    return res.json({ 
      previewUrl: previewData.signedUrl,
      fileType: previewType,
      fileName: fileData.name
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to generate preview' });
  }
});

export default router;
