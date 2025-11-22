const express = require('express');
const router = express.Router();
const Animal = require('../models/Animal');
const MedicalLog = require('../models/MedicalLog');
const Compliance = require('../models/Compliance');
const { requireAuth, requireRole } = require('../middleware/auth');

// GET /dashboard - Farmer dashboard with herd overview
router.get('/dashboard', requireAuth, requireRole('farmer'), async (req, res) => {
    try {
        const animals = await Animal.findByOwner(req.session.userId);

        // Calculate aggregate stats
        const totalAnimals = animals.length;
        const healthyCount = animals.filter(a => a.status === 'HEALTHY').length;
        const lockedCount = animals.filter(a => a.status === 'WITHDRAWAL_LOCK').length;
        const quarantineCount = animals.filter(a => a.status === 'QUARANTINE').length;
        const avgHealthScore = animals.length > 0
            ? (animals.reduce((sum, a) => sum + a.healthScore, 0) / animals.length).toFixed(1)
            : 100;

        // Fetch biosecurity compliance score (7-day average)
        const biosecurityScore = await Compliance.getAverageScore(req.session.userId, 7);

        res.render('farmer/dashboard', {
            user: { role: req.session.userRole, name: req.session.userName },
            animals,
            stats: {
                total: totalAnimals,
                healthy: healthyCount,
                locked: lockedCount,
                quarantine: quarantineCount,
                avgHealthScore,
                biosecurityScore  // Add biosecurity score to stats
            }
        });

    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).render('error', {
            user: { role: req.session.userRole },
            message: 'Failed to load dashboard'
        });
    }
});

// GET /animals/add - Show add animal form
router.get('/animals/add', requireAuth, requireRole('farmer'), (req, res) => {
    res.render('farmer/add-animal', {
        user: { role: req.session.userRole, name: req.session.userName },
        error: null
    });
});

// POST /animals - Create new animal
router.post('/animals', requireAuth, requireRole('farmer'), async (req, res) => {
    try {
        const { tagId, species, breed, geneticLineage, dateOfBirth } = req.body;

        // Validation
        if (!tagId || !species) {
            return res.render('farmer/add-animal', {
                user: { role: req.session.userRole, name: req.session.userName },
                error: 'Tag ID and species are required'
            });
        }

        // Check if tag ID already exists
        const existing = await Animal.findByTagId(tagId);
        if (existing) {
            return res.render('farmer/add-animal', {
                user: { role: req.session.userRole, name: req.session.userName },
                error: 'Tag ID already exists. Please use a unique ID.'
            });
        }

        // Create animal
        await Animal.create({
            tagId,
            species,
            breed,
            geneticLineage,
            dateOfBirth,
            ownerId: req.session.userId
        });

        res.redirect('/dashboard');

    } catch (error) {
        console.error('Add animal error:', error);
        res.render('farmer/add-animal', {
            user: { role: req.session.userRole, name: req.session.userName },
            error: 'Failed to add animal. Please try again.'
        });
    }
});

// GET /animals/:id - View animal details
router.get('/animals/:id', requireAuth, requireRole('farmer'), async (req, res) => {
    try {
        const animal = await Animal.findById(req.params.id);

        if (!animal) {
            return res.status(404).render('error', {
                user: { role: req.session.userRole },
                message: 'Animal not found'
            });
        }

        // Verify ownership
        if (animal.ownerId.toString() !== req.session.userId) {
            return res.status(403).render('error', {
                user: { role: req.session.userRole },
                message: 'Access denied'
            });
        }

        // Get medical history
        const medicalLogs = await MedicalLog.findByAnimal(animal._id);

        // Calculate days remaining if locked
        let daysRemaining = 0;
        if (animal.status === 'WITHDRAWAL_LOCK' && animal.withdrawalEndsAt) {
            const now = new Date();
            const diff = animal.withdrawalEndsAt - now;
            daysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
        }

        res.render('farmer/animal-profile', {
            user: { role: req.session.userRole, name: req.session.userName },
            animal,
            medicalLogs,
            daysRemaining
        });

    } catch (error) {
        console.error('View animal error:', error);
        res.status(500).render('error', {
            user: { role: req.session.userRole },
            message: 'Failed to load animal details'
        });
    }
});

// DELETE /animals/:id - Delete animal
router.post('/animals/:id/delete', requireAuth, requireRole('farmer'), async (req, res) => {
    try {
        const animal = await Animal.findById(req.params.id);

        if (!animal) {
            return res.status(404).json({ success: false, error: 'Animal not found' });
        }

        // Verify ownership
        if (animal.ownerId.toString() !== req.session.userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await Animal.deleteById(req.params.id);
        res.json({ success: true });

    } catch (error) {
        console.error('Delete animal error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete animal' });
    }
});

module.exports = router;
