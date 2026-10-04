'use strict';

/**
 * sms controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::sms.sms');
