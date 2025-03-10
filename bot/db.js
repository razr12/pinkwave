require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        dialect: 'postgres',
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        logging: false, 
    }
);

async function connectDB() {
    try {
        await sequelize.authenticate(); 
    } catch (error) {
        console.error(error);
    }
}

async function syncDB() {
    try {
        await sequelize.sync({ alter: true });
    } catch (error) {
        console.error(error);
    }
}

module.exports = { sequelize, connectDB, syncDB };

