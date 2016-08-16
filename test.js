'use strict';

import querystring     from 'querystring';
import logger          from 'intel';
import Base            from '../Base';
import mongoose        from '../../mongoose';
import Paymentwall     from 'paymentwall';
import accountConfig   from '../../../etc/accountConfig.json';
import { paymentwall } from '../../../etc/config.json';

const User = mongoose.model('User');

logger.addHandler(new logger.handlers.File('./logs/paymentwall-pingbacks.log'));

const STATUS_PRODUCT_PURCHASED = 0;
const STARTER_ACCOUNT          = 'STARTER';
const ACTIVE_ACCOUNT           = 'ACTIVE';
const STARTER_ACCOUNT_PRICE    = accountConfig[STARTER_ACCOUNT].price;
const ACTIVE_ACCOUNT_PRICE     = accountConfig[ACTIVE_ACCOUNT].price;
const CUSTOM_CREDIT_1_PRICE    = paymentwall.pricelist.customCredit1.price;
const PRODUCT_STARTER_ACCOUNT  = 'starter_account_paymentwall';
const PRODUCT_ACTIVE_ACCOUNT   = 'active_account_paymentwall';
const CUSTOM_CREDIT_1          = 'custom_credit1';
const SUCCESS_RESPONSE_TEXT    = 'OK';
const FAIL_RESPONSE_TEXT       = 'fail';

Paymentwall.configure(
    Paymentwall.Base.API_GOODS,
    paymentwall.keys.project,
    paymentwall.keys.secret
);

export default class HandlePingback extends Base {
    validate(data) {
        const rules = {
            query   : 'required',
            ip      : 'required'
        };

        return this.validator.validate(data, rules);
    }

    async execute(data) {
        const isTestMode = process.env.TEST_MODE && paymentwall.authorizedTestIpAddresses.indexOf(data.ip) !== -1;

        if (!isTestMode && paymentwall.authorizedIpAddresses.indexOf(data.ip) === -1) {
            return;
        }

        const {
            query,
            ip
        } = data;

        const {
            uid,
            type
        } = querystring.parse(query);

        const pingback = new Paymentwall.Pingback(query, ip);
        if (pingback.validate(isTestMode)) {
            const productId = pingback.getProduct().getId();
            if (pingback.isDeliverable()) {
                return await this.handlePayment({productId, uid, type: +type, query, isTestMode});
            }
        } else {
            console.log(pingback.getErrorSummary());
        }
        logger.info([
            '{',
            '    type      : ' + type,
            '    date      : ' + new Date(),
            '    query     : ' + query,
            '    testMode  : ' + isTestMode,
            '    unvalidated',
            '}',
            ''
        ].join('\n'));

        return FAIL_RESPONSE_TEXT;
    }

    async handlePayment({ productId, uid, type, query, isTestMode }) {
        let isHandled = false;

        if (type === STATUS_PRODUCT_PURCHASED) {
            const existingUser = await User.findById(uid);
            isHandled = true;
            switch (productId) {
                case PRODUCT_STARTER_ACCOUNT:
                    await existingUser.addCredit(Math.round(STARTER_ACCOUNT_PRICE), 'paymentwall');
                    await existingUser.updateAccountType(STARTER_ACCOUNT);

                    break;
                case PRODUCT_ACTIVE_ACCOUNT:
                    await existingUser.addCredit(Math.round(ACTIVE_ACCOUNT_PRICE), 'paymentwall');
                    await existingUser.updateAccountType(ACTIVE_ACCOUNT);

                    break;
                case CUSTOM_CREDIT_1:
                    await existingUser.addCredit(Math.round(CUSTOM_CREDIT_1_PRICE), 'paymentwall');
                    break;
                default:
                    isHandled = false;
                    break;
            }
        }

        logger.info([
            '{',
            '    type      : ' + type,
            '    date      : ' + new Date(),
            '    query     : ' + query,
            '    isHandled : ' + isHandled,
            '    testMode  : ' + isTestMode,
            '    validated',
            '}',
            ''
        ].join('\n'));

        return SUCCESS_RESPONSE_TEXT;
    }
}