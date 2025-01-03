const express = require('express')
const uploadsControllers = require('../Controllers/alfonController')
const authController = require('../Controllers/AuthController')
const utils = require('../utils/RecordOperation')
const { backupMiddleware } = require('../backup/backups/backup');

const router = express.Router()

router.route('/get-user-details/:AnashIdentifier').get( authController.protect, uploadsControllers.getUserDetails);
router.route('/').get(express.json({ limit: '50mb' }),  uploadsControllers.getPeople)
router.route('/upload').post( express.json({ limit: '50mb' }),authController.protect,authController.restrictTo(['Admin']),backupMiddleware, uploadsControllers.uploadPeople)
router.route('/update-user-details').post( authController.protect,authController.restrictTo(['Admin', 'User']),  uploadsControllers.updateUserDetails)
router.route('/delete-user/:AnashIdentifier').delete(  authController.protect,authController.restrictTo(['Admin', 'User']), uploadsControllers.deleteUser)
router.route('/add-user').post( authController.protect,authController.restrictTo(['Admin', 'User']), uploadsControllers.addPerson)
router.route('/review-uploaded-people').post(express.json({ limit: '50mb' }),authController.protect,authController.restrictTo(['Admin', 'User']), uploadsControllers.reviewUploadedPeople)
router.route('/recover-user-activity/:AnashIdentifier').put( authController.protect, authController.restrictTo(['Admin', 'User']), uploadsControllers.recoverUserActivity)

module.exports = router 