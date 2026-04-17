/**
 * DriveService — All Google Drive CRUD operations.
 * Folder structure under the root:
 *   /ComplianceApp
 *     /standards   ← JSON files per standard
 *     /controls    ← JSON files per control
 *     /files       ← sub-folder per control for attachments
 */

// =====================================================================
//  Folder helpers (private)
// =====================================================================

function getRootFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { /* folder deleted or moved — recreate below */ }
  }
  // Auto-create on first access
  const folder = DriveApp.createFolder('ComplianceApp');
  PropertiesService.getScriptProperties().setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function getOrCreateSub_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function standardsFolder_()        { return getOrCreateSub_(getRootFolder_(), 'standards'); }
function controlsFolder_()         { return getOrCreateSub_(getRootFolder_(), 'controls');  }
function filesFolder_(controlId)   { return getOrCreateSub_(getOrCreateSub_(getRootFolder_(), 'files'), controlId); }

// =====================================================================
//  JSON file helpers (private)
// =====================================================================

function readJson_(folder, name) {
  const it = folder.getFilesByName(name + '.json');
  if (!it.hasNext()) return null;
  return JSON.parse(it.next().getBlob().getDataAsString());
}

function writeJson_(folder, name, data) {
  const json = JSON.stringify(data, null, 2);
  const it   = folder.getFilesByName(name + '.json');
  if (it.hasNext()) { it.next().setContent(json); }
  else { folder.createFile(name + '.json', json, MimeType.PLAIN_TEXT); }
}

function deleteJson_(folder, name) {
  const it = folder.getFilesByName(name + '.json');
  if (it.hasNext()) it.next().setTrashed(true);
}

// =====================================================================
//  Standards
// =====================================================================

function getStandards() {
  const folder = standardsFolder_();
  const it = folder.getFiles();
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().endsWith('.json')) {
      out.push(JSON.parse(f.getBlob().getDataAsString()));
    }
  }
  return out;
}

function getStandard(id)   { return readJson_(standardsFolder_(), id); }
function saveStandard(data){ writeJson_(standardsFolder_(), data.id, data); return data; }

function deleteStandard(standardId) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const std = getStandard(standardId);
    if (!std) return;
    // Delete all controls belonging to this standard
    (std.clauses || []).forEach(function(cid) {
      deleteJson_(controlsFolder_(), cid);
    });
    deleteJson_(standardsFolder_(), standardId);
  } finally { lock.releaseLock(); }
}

// =====================================================================
//  Controls
// =====================================================================

function getControls(standardId) {
  const std = getStandard(standardId);
  if (!std) return [];
  const folder = controlsFolder_();
  return (std.clauses || []).map(function(cid) { return readJson_(folder, cid); }).filter(Boolean);
}

function getControl(controlId) {
  return readJson_(controlsFolder_(), controlId);
}

function saveControl(data) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    writeJson_(controlsFolder_(), data.id, data);
    // Ensure control is listed in its standard
    const std = getStandard(data.standardId);
    if (std && (std.clauses || []).indexOf(data.id) === -1) {
      std.clauses.push(data.id);
      saveStandard(std);
    }
  } finally { lock.releaseLock(); }
  return data;
}

function deleteControl(controlId) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const ctrl = getControl(controlId);
    if (!ctrl) return;
    const std = getStandard(ctrl.standardId);
    if (std) {
      std.clauses = (std.clauses || []).filter(function(id) { return id !== controlId; });
      saveStandard(std);
    }
    deleteJson_(controlsFolder_(), controlId);
  } finally { lock.releaseLock(); }
}

// =====================================================================
//  Files / Attachments
// =====================================================================

function getControlFiles(controlId) {
  const folder = filesFolder_(controlId);
  const it = folder.getFiles();
  const out = [];
  while (it.hasNext()) {
    const f = it.next();
    out.push({ id: f.getId(), name: f.getName(), mimeType: f.getMimeType(),
               size: f.getSize(), url: f.getUrl() });
  }
  return out;
}

function uploadFile(controlId, base64Data, fileName, mimeType) {
  const folder  = filesFolder_(controlId);
  const decoded = Utilities.base64Decode(base64Data);
  const blob    = Utilities.newBlob(decoded, mimeType, fileName);
  const file    = folder.createFile(blob);
  return { id: file.getId(), name: file.getName(), mimeType: file.getMimeType(),
           size: file.getSize(), url: file.getUrl() };
}

function deleteFile(fileId) {
  DriveApp.getFileById(fileId).setTrashed(true);
}

function linkDriveItem(controlId, url) {
  var id = extractDriveId_(url);
  if (!id) throw new Error('Could not parse a Drive file or folder ID from that URL.');
  var folder = filesFolder_(controlId);
  // Try as file first, then as folder
  try {
    var file = DriveApp.getFileById(id);
    var shortcut = file.createShortcut(folder.getId());
    var sc = DriveApp.getFileById(shortcut.getId ? shortcut.getId() : shortcut);
    return { id: sc.getId(), name: sc.getName(), mimeType: sc.getMimeType(),
             size: 0, url: file.getUrl() };
  } catch (e1) {
    try {
      var target = DriveApp.getFolderById(id);
      // Create a shortcut via Advanced Drive if available, otherwise add a .url bookmark
      var name = target.getName() + '.link.txt';
      var link = 'https://drive.google.com/drive/folders/' + id;
      var bookmark = folder.createFile(name, link, MimeType.PLAIN_TEXT);
      return { id: bookmark.getId(), name: target.getName() + ' (folder link)',
               mimeType: 'text/plain', size: bookmark.getSize(), url: link };
    } catch (e2) {
      throw new Error('Cannot access that file or folder. Check the URL and sharing permissions.');
    }
  }
}

function extractDriveId_(url) {
  // Handles /d/ID, /folders/ID, ?id=ID, and open?id=ID patterns
  var m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
          url.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
          url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function getDrawioXml(fileId) {
  return DriveApp.getFileById(fileId).getBlob().getDataAsString();
}

// =====================================================================
//  Google Docs / Sheets creation
// =====================================================================

function createGoogleDoc(controlId, title) {
  const doc    = DocumentApp.create(title);
  const file   = DriveApp.getFileById(doc.getId());
  const folder = filesFolder_(controlId);
  file.moveTo(folder);
  return { id: doc.getId(), name: title,
           mimeType: 'application/vnd.google-apps.document', url: doc.getUrl() };
}

function createGoogleSheet(controlId, title) {
  const ss     = SpreadsheetApp.create(title);
  const file   = DriveApp.getFileById(ss.getId());
  const folder = filesFolder_(controlId);
  file.moveTo(folder);
  return { id: ss.getId(), name: title,
           mimeType: 'application/vnd.google-apps.spreadsheet', url: ss.getUrl() };
}

// =====================================================================
//  Batch helpers (reduce client round-trips)
// =====================================================================

/**
 * Returns all standards + controls for the first standard in one call.
 * Eliminates 2 sequential round-trips on page load.
 */
function getBootstrapData() {
  const standards = getStandards();
  var controls = [];
  if (standards.length) {
    controls = getControls(standards[0].id);
  }
  return { standards: standards, controls: controls, firstStandardId: standards.length ? standards[0].id : null, version: APP_VERSION };
}

/**
 * Returns control data + file list + drawio XML in a single call.
 * Eliminates 2–3 sequential round-trips when selecting a control.
 */
function getControlWithFiles(controlId) {
  const ctrl = getControl(controlId);
  if (!ctrl) return null;
  const files = getControlFiles(controlId);
  var drawioXml = null;
  for (var i = 0; i < files.length; i++) {
    if (files[i].name && files[i].name.endsWith('.drawio')) {
      drawioXml = { fileId: files[i].id, xml: getDrawioXml(files[i].id) };
      break;
    }
  }
  return { control: ctrl, files: files, drawio: drawioXml };
}

// =====================================================================
//  Sample Data + draw.io diagram generator
// =====================================================================

function initSampleData() {
  // --- Standard ---
  const std = { id: 'iso27001', name: 'ISO 27001:2022',
                description: 'Information Security Management System', clauses: [] };
  saveStandard(std);

  // --- Layer template ---
  const layerTpl = [
    { id: 'inspection',   label: 'Inspection / Audit', order: 0, content: '' },
    { id: 'policy',       label: 'Policy',             order: 1, content: '' },
    { id: 'procedures',   label: 'Procedures',         order: 2, content: '' },
    { id: 'instructions', label: 'Work Instructions',  order: 3, content: '' },
    { id: 'evidence',     label: 'Evidence & Records',  order: 4, content: '' }
  ];

  // --- Controls ---
  const controls = [
    {
      id: 'iso27001-A.5.1', standardId: 'iso27001', clauseRef: 'A.5.1',
      title: 'Policies for Information Security',
      sourceText: 'A set of policies for information security shall be defined, approved by management, published and communicated to relevant personnel and relevant interested parties.',
      description: 'Ensures the organization maintains a documented information security policy framework.',
      classification: 'Internal', version: '1.0', customFields: {}, mappings: [],
      layers: JSON.parse(JSON.stringify(layerTpl))
    },
    {
      id: 'iso27001-A.5.2', standardId: 'iso27001', clauseRef: 'A.5.2',
      title: 'Information Security Roles and Responsibilities',
      sourceText: 'Information security roles and responsibilities shall be defined and allocated.',
      description: 'Clear assignment of security responsibilities across the organization.',
      classification: 'Internal', version: '1.0', customFields: {}, mappings: ['iso27001-A.5.1'],
      layers: JSON.parse(JSON.stringify(layerTpl))
    },
    {
      id: 'iso27001-A.8.1', standardId: 'iso27001', clauseRef: 'A.8.1',
      title: 'User Endpoint Devices',
      sourceText: 'Information stored on, processed by or accessible via user endpoint devices shall be protected.',
      description: 'Controls for securing laptops, mobile devices and other endpoint equipment.',
      classification: 'Confidential', version: '1.0', customFields: {}, mappings: ['iso27001-A.5.1'],
      layers: JSON.parse(JSON.stringify(layerTpl))
    }
  ];

  // Fill sample content for first control
  controls[0].layers[0].content = '<h3>Audit Checklist</h3><ul><li>Verify policy document exists and is current</li><li>Check management approval date</li><li>Confirm distribution to all personnel</li><li>Review acknowledgement records</li></ul>';
  controls[0].layers[1].content = '<h3>Information Security Policy</h3><p>The organization is committed to protecting information assets. This policy establishes the framework for information security management.</p><p><strong>Scope:</strong> All employees, contractors and third parties.</p><p><strong>Owner:</strong> Chief Information Security Officer</p>';
  controls[0].layers[2].content = '<h3>Policy Review Procedure</h3><ol><li>Annual review scheduled by CISO</li><li>Draft updates circulated to stakeholders</li><li>Management approval meeting</li><li>Updated policy published on intranet</li><li>Communication to all staff via email</li></ol>';
  controls[0].layers[3].content = '<h3>How to Access Policies</h3><p>1. Go to company intranet → Security → Policies</p><p>2. All policies available as PDF downloads</p><p>3. New employees receive policies during onboarding</p>';
  controls[0].layers[4].content = '<h3>Evidence</h3><ul><li>Policy document v3.2 (see attached PDF)</li><li>Management approval email — 2024-01-15</li><li>Staff acknowledgement tracker (see attached Sheet)</li></ul>';

  // Fill sample content for A.8.1
  controls[2].layers[0].content = '<h3>Audit Focus</h3><ul><li>Review endpoint device inventory</li><li>Check MDM enrolment rate</li><li>Verify encryption status on all laptops</li><li>Sample 5 devices for compliance spot-check</li></ul>';
  controls[2].layers[1].content = '<h3>Endpoint Security Policy</h3><p>All company-issued and BYOD devices that access corporate data must comply with the endpoint security baseline:</p><ul><li>Full-disk encryption enabled</li><li>MDM agent installed</li><li>Auto-lock after 5 minutes</li><li>Approved OS versions only</li></ul>';
  controls[2].layers[2].content = '<h3>Endpoint Provisioning Procedure</h3><ol><li>IT receives hardware request via service desk</li><li>Device configured per security baseline image</li><li>MDM enrolment and compliance verification</li><li>Device issued to user with acknowledgement form</li><li>Quarterly compliance scan by IT Security</li></ol>';

  controls.forEach(function(c) { saveControl(c); });

  // --- Upload sample draw.io diagram to A.8.1 ---
  const drawioXml = buildSampleDrawioXml_();
  const blob = Utilities.newBlob(drawioXml, 'application/xml', 'incident-management.drawio');
  filesFolder_('iso27001-A.8.1').createFile(blob);

  return { success: true, message: 'Sample data created: ' + controls.length + ' controls + draw.io diagram.' };
}

// =====================================================================
//  draw.io XML builder — 3-page "Incident Management" process
// =====================================================================

function buildSampleDrawioXml_() {
  var xml = '<mxfile host="ComplianceApp">\n';

  // ---- PAGE 1: Strategic Overview ----
  xml += '<diagram id="page-0" name="1 — Strategic Overview">\n';
  xml += '<mxGraphModel dx="1222" dy="500" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827">\n<root>\n';
  xml += cell_(0) + cell_(1, 0);
  // Title
  xml += box_('p1-t', 'Incident Management — Strategic Overview', 200, 20, 600, 40, 'text;html=1;fontSize=18;fontStyle=1;align=center;verticalAlign=middle;');
  // Steps
  var p1 = [
    ['Detect',   'Identify incident'],
    ['Classify', 'Assess severity'],
    ['Respond',  'Contain & mitigate'],
    ['Recover',  'Restore services'],
    ['Review',   'Lessons learned']
  ];
  p1.forEach(function(s, i) {
    xml += box_('p1-s' + i, '<b>' + s[0] + '</b><br>' + s[1], 40 + i * 220, 120, 160, 80,
      'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=14;');
  });
  for (var i = 0; i < p1.length - 1; i++) {
    xml += edge_('p1-e' + i, 'p1-s' + i, 'p1-s' + (i + 1));
  }
  xml += '</root>\n</mxGraphModel>\n</diagram>\n';

  // ---- PAGE 2: Operational Procedures ----
  xml += '<diagram id="page-1" name="2 — Operational Procedures">\n';
  xml += '<mxGraphModel dx="1222" dy="680" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827">\n<root>\n';
  xml += cell_(0) + cell_(1, 0);
  xml += box_('p2-t', 'Incident Management — Operational Procedures', 150, 10, 700, 36, 'text;html=1;fontSize=16;fontStyle=1;align=center;verticalAlign=middle;');

  // Role bands (background rectangles)
  xml += box_('p2-band1', '<b>IT Operations</b>',   10,  55, 980, 120, 'rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#cccccc;fontSize=13;fontStyle=1;verticalAlign=top;align=left;spacingLeft=8;');
  xml += box_('p2-band2', '<b>Security Team</b>',    10, 185, 980, 120, 'rounded=0;whiteSpace=wrap;html=1;fillColor=#fff8e1;strokeColor=#cccccc;fontSize=13;fontStyle=1;verticalAlign=top;align=left;spacingLeft=8;');
  xml += box_('p2-band3', '<b>Management</b>',       10, 315, 980, 120, 'rounded=0;whiteSpace=wrap;html=1;fillColor=#e8f5e9;strokeColor=#cccccc;fontSize=13;fontStyle=1;verticalAlign=top;align=left;spacingLeft=8;');

  // IT Ops row
  xml += box_('p2-it1', 'Monitor<br>Alerts',        30,  85, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=12;');
  xml += box_('p2-it2', 'Initial<br>Triage',        210, 85, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=12;');
  xml += box_('p2-it3', 'Execute<br>Remediation',   640, 85, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=12;');
  xml += box_('p2-it4', 'Verify<br>Resolution',     830, 85, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=12;');

  // Security row
  xml += box_('p2-sec1', 'Assess<br>Impact',        210, 215, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=12;');
  xml += box_('p2-sec2', 'Contain<br>Threat',       400, 215, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=12;');
  xml += box_('p2-sec3', 'Root Cause<br>Analysis',  640, 215, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=12;');

  // Management row
  xml += box_('p2-mgr1', 'Receive<br>Escalation',   400, 345, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=12;');
  xml += box_('p2-mgr2', 'Approve<br>Response Plan', 640, 345, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=12;');
  xml += box_('p2-mgr3', 'Sign-off<br>& Close', 830, 345, 130, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=12;');

  // Edges
  xml += edge_('p2-e1', 'p2-it1',  'p2-it2');
  xml += edge_('p2-e2', 'p2-it2',  'p2-sec1');
  xml += edge_('p2-e3', 'p2-sec1', 'p2-sec2');
  xml += edge_('p2-e4', 'p2-sec2', 'p2-mgr1');
  xml += edge_('p2-e5', 'p2-mgr1', 'p2-mgr2');
  xml += edge_('p2-e6', 'p2-mgr2', 'p2-it3');
  xml += edge_('p2-e7', 'p2-it3',  'p2-sec3');
  xml += edge_('p2-e8', 'p2-sec3', 'p2-it4');
  xml += edge_('p2-e9', 'p2-it4',  'p2-mgr3');

  xml += '</root>\n</mxGraphModel>\n</diagram>\n';

  // ---- PAGE 3: Detailed Work Instructions ----
  xml += '<diagram id="page-2" name="3 — Detailed Work Instructions">\n';
  xml += '<mxGraphModel dx="1222" dy="780" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827">\n<root>\n';
  xml += cell_(0) + cell_(1, 0);
  xml += box_('p3-t', 'Incident Management — Detailed Work Instructions', 150, 10, 700, 36, 'text;html=1;fontSize=16;fontStyle=1;align=center;verticalAlign=middle;');

  // Start
  xml += box_('p3-start', 'Alert<br>Notification', 40, 80, 140, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=12;');
  // Step: check dashboard
  xml += box_('p3-s1', 'Open Grafana<br>Dashboard', 240, 80, 140, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontSize=12;');
  // Decision 1
  xml += box_('p3-d1', 'Severity<br>>= High?', 450, 80, 120, 80, 'rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=12;');

  // HIGH path (top)
  xml += box_('p3-h1', 'Page On-Call<br>Engineer', 650, 30, 140, 55, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;');
  xml += box_('p3-h2', 'Isolate Affected<br>System', 850, 30, 140, 55, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;');
  xml += box_('p3-h3', 'Notify CISO<br>within 30 min', 650, 110, 140, 55, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;');
  xml += box_('p3-h4', 'Assemble<br>Response Team', 850, 110, 140, 55, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;');

  // LOW path (bottom)
  xml += box_('p3-l1', 'Create Ticket<br>in JIRA', 450, 220, 140, 55, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;');
  xml += box_('p3-l2', 'Schedule Fix<br>in Next Sprint', 650, 220, 140, 55, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;');
  xml += box_('p3-l3', 'Implement &<br>Test Fix', 850, 220, 140, 55, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontSize=11;');

  // Decision 2: resolution ok?
  xml += box_('p3-d2', 'Resolution<br>Verified?', 650, 340, 120, 80, 'rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=12;');
  // End
  xml += box_('p3-end', 'Close Incident<br>& File Report', 850, 350, 140, 60, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=12;');
  // Reopen
  xml += box_('p3-re', 'Reopen &<br>Reassign', 450, 355, 130, 50, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontSize=11;');

  // Edges
  xml += edge_('p3-e0', 'p3-start', 'p3-s1');
  xml += edge_('p3-e1', 'p3-s1', 'p3-d1');
  xml += edgeLabel_('p3-e2', 'p3-d1', 'p3-h1', 'Yes');
  xml += edge_('p3-e3', 'p3-h1', 'p3-h2');
  xml += edge_('p3-e3b', 'p3-h1', 'p3-h3');
  xml += edge_('p3-e3c', 'p3-h3', 'p3-h4');
  xml += edge_('p3-e3d', 'p3-h2', 'p3-d2');
  xml += edge_('p3-e3e', 'p3-h4', 'p3-d2');
  xml += edgeLabel_('p3-e4', 'p3-d1', 'p3-l1', 'No');
  xml += edge_('p3-e5', 'p3-l1', 'p3-l2');
  xml += edge_('p3-e6', 'p3-l2', 'p3-l3');
  xml += edge_('p3-e7', 'p3-l3', 'p3-d2');
  xml += edgeLabel_('p3-e8', 'p3-d2', 'p3-end', 'Yes');
  xml += edgeLabel_('p3-e9', 'p3-d2', 'p3-re', 'No');
  xml += edge_('p3-e10', 'p3-re', 'p3-s1');

  xml += '</root>\n</mxGraphModel>\n</diagram>\n';
  xml += '</mxfile>';
  return xml;
}

// --- tiny XML helpers ---

function cell_(id, parent) {
  if (parent === undefined) return '<mxCell id="' + id + '"/>\n';
  return '<mxCell id="' + id + '" parent="' + parent + '"/>\n';
}

function escXml_(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function box_(id, label, x, y, w, h, style) {
  return '<mxCell id="' + id + '" value="' + escXml_(label) + '" style="' + style +
         '" vertex="1" parent="1"><mxGeometry x="' + x + '" y="' + y +
         '" width="' + w + '" height="' + h + '" as="geometry"/></mxCell>\n';
}

function edge_(id, src, tgt) {
  return '<mxCell id="' + id + '" style="endArrow=block;endFill=1;" edge="1" source="' +
         src + '" target="' + tgt + '" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>\n';
}

function edgeLabel_(id, src, tgt, label) {
  return '<mxCell id="' + id + '" value="' + escXml_(label) + '" style="endArrow=block;endFill=1;fontSize=11;" edge="1" source="' +
         src + '" target="' + tgt + '" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>\n';
}
