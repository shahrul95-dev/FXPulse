require('dotenv').config();

module.exports = {
  apiKeys: process.env.API_KEYS.split(','),
  usageLimit: parseInt(process.env.USAGE_LIMIT || '800'),
  currencies: process.env.CURRENCIES.split(','),
  baseCurrency: 'USD',
};
