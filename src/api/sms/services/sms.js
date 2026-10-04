'use strict';

/**
 * sms service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::sms.sms');
