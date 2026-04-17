/**
 * Compliance Controls — Google Apps Script Web App
 * Entry point and utility functions.
 */

/** Update before each deployment (matches the deployment description). */
var APP_VERSION = '1.0.0';

/**
 * Serves the main web application.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Compliance Controls')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Include HTML partials (Styles, App) in the template.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Set or auto-create the root Drive folder.
 * Run once per environment (dev / enterprise).
 *   initEnvironment()                → auto-creates "ComplianceApp" folder
 *   initEnvironment('1abc...xyz')    → uses existing folder
 */
function initEnvironment(rootFolderId) {
  if (rootFolderId) {
    PropertiesService.getScriptProperties().setProperty('ROOT_FOLDER_ID', rootFolderId);
    Logger.log('Root folder set to: ' + rootFolderId);
    return rootFolderId;
  }
  const folder = DriveApp.createFolder('ComplianceApp');
  PropertiesService.getScriptProperties().setProperty('ROOT_FOLDER_ID', folder.getId());
  Logger.log('Created root folder: ' + folder.getId() + ' (' + folder.getUrl() + ')');
  return folder.getId();
}
