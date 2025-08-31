"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabase_1 = require("../lib/supabase");
const router = express_1.default.Router();
// Middleware to check authentication
const authenticate = async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    const { data: { user }, error } = await supabase_1.supabase.auth.getUser(token);
    if (error || !user) {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    req.user = user;
    next();
};
// Get all folders for user
router.get('/', authenticate, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase_1.supabase
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
router.post('/', authenticate, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized' });
    const { name, parent_id } = req.body;
    const { data, error } = await supabase_1.supabase
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
router.put('/:id', authenticate, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { name } = req.body;
    const { data, error } = await supabase_1.supabase
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
router.delete('/:id', authenticate, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { error } = await supabase_1.supabase
        .from('folders')
        .update({ is_deleted: true })
        .eq('id', id)
        .eq('user_id', req.user.id);
    if (error) {
        return res.status(400).json({ error: error.message });
    }
    return res.json({ message: 'Folder moved to trash' });
});
exports.default = router;
//# sourceMappingURL=folders.js.map