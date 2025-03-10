const { DataTypes } = require('sequelize');
const { sequelize } = require('../bot/db');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    allowNull: false,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  walletAddress: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  privateKey: {
    type: DataTypes.STRING,
    allowNull: false, 
  },
}, {
  timestamps: true, 
});

module.exports = {
  User
};
