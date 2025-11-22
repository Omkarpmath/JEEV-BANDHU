const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');

class WeightRecord {
    // Add a weight record for an animal
    static async addWeightRecord(recordData) {
        const db = getDB();

        const record = {
            animalId: new ObjectId(recordData.animalId),
            weight: parseFloat(recordData.weight),
            recordedDate: new Date(recordData.recordedDate || Date.now()),
            notes: recordData.notes || '',
            createdAt: new Date()
        };

        const result = await db.collection('weight_records').insertOne(record);
        return { ...record, _id: result.insertedId };
    }

    // Get weight history for an animal
    static async getWeightHistory(animalId, limit = null) {
        const db = getDB();

        const query = db.collection('weight_records')
            .find({ animalId: new ObjectId(animalId) })
            .sort({ recordedDate: -1 });

        if (limit) {
            query.limit(limit);
        }

        return await query.toArray();
    }

    // Calculate average weight gain per month for an animal
    static async calculateWeightGain(animalId) {
        const records = await this.getWeightHistory(animalId);

        if (records.length < 2) {
            return { averageGainPerMonth: 0, totalGain: 0 };
        }

        // Sort by date ascending
        records.sort((a, b) => new Date(a.recordedDate) - new Date(b.recordedDate));

        const firstRecord = records[0];
        const lastRecord = records[records.length - 1];

        const totalGain = lastRecord.weight - firstRecord.weight;
        const daysDiff = (new Date(lastRecord.recordedDate) - new Date(firstRecord.recordedDate)) / (1000 * 60 * 60 * 24);
        const monthsDiff = daysDiff / 30;

        const averageGainPerMonth = monthsDiff > 0 ? totalGain / monthsDiff : 0;

        return {
            averageGainPerMonth: Math.round(averageGainPerMonth * 100) / 100,
            totalGain: Math.round(totalGain * 100) / 100,
            initialWeight: firstRecord.weight,
            currentWeight: lastRecord.weight,
            monthsTracked: Math.round(monthsDiff * 10) / 10
        };
    }

    // Get average weight gain for all animals of a farmer
    static async getFarmAverageWeightGain(farmerId, period = '1m') {
        const db = getDB();

        // Calculate date range based on period
        const endDate = new Date();
        const startDate = new Date();
        switch (period) {
            case '1m':
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            case '6m':
                startDate.setMonth(startDate.getMonth() - 6);
                break;
            case '1y':
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
        }

        // Get all animals for this farmer
        const animals = await db.collection('animals').find({ ownerId: new ObjectId(farmerId) }).toArray();

        if (animals.length === 0) return 0;

        let totalGain = 0;
        let animalCount = 0;

        for (const animal of animals) {
            const gainData = await this.calculateWeightGain(animal._id);
            if (gainData.averageGainPerMonth > 0) {
                totalGain += gainData.averageGainPerMonth;
                animalCount++;
            }
        }

        return animalCount > 0 ? Math.round((totalGain / animalCount) * 100) / 100 : 0;
    }

    // Get time-series data for charts
    static async getWeightTrends(farmerId, period = '6m') {
        const db = getDB();

        const endDate = new Date();
        const startDate = new Date();
        switch (period) {
            case '1m':
                startDate.setMonth(startDate.getMonth() - 1);
                break;
            case '6m':
                startDate.setMonth(startDate.getMonth() - 6);
                break;
            case '1y':
                startDate.setFullYear(startDate.getFullYear() - 1);
                break;
        }

        // Get all animals for this farmer
        const animals = await db.collection('animals').find({ ownerId: new ObjectId(farmerId) }).toArray();
        const animalIds = animals.map(a => a._id);

        // Get all weight records in the period
        const records = await db.collection('weight_records')
            .find({
                animalId: { $in: animalIds },
                recordedDate: { $gte: startDate, $lte: endDate }
            })
            .sort({ recordedDate: 1 })
            .toArray();

        // Group by month and calculate average
        const monthlyAverages = {};

        records.forEach(record => {
            const monthKey = new Date(record.recordedDate).toISOString().substring(0, 7); // YYYY-MM
            if (!monthlyAverages[monthKey]) {
                monthlyAverages[monthKey] = { total: 0, count: 0 };
            }
            monthlyAverages[monthKey].total += record.weight;
            monthlyAverages[monthKey].count += 1;
        });

        // Convert to array format for charts
        return Object.keys(monthlyAverages).sort().map(month => ({
            month,
            averageWeight: Math.round((monthlyAverages[month].total / monthlyAverages[month].count) * 100) / 100
        }));
    }
}

module.exports = WeightRecord;
