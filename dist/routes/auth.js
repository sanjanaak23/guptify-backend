"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabase_1 = require("../lib/supabase"); // Import the already configured supabase client
const router = express_1.default.Router();
// Sign up
router.post('/signup', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase_1.supabase.auth.signUp({
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
    const { data, error } = await supabase_1.supabase.auth.signInWithPassword({
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
    const { error } = await supabase_1.supabase.auth.signOut();
    if (error) {
        return res.status(400).json({ error: error.message });
    }
    return res.json({ message: 'Signed out successfully' });
});
exports.default = router;
//# sourceMappingURL=auth.js.map