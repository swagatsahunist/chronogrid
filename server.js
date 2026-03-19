// ================================================================
// CHRONOGRID — server.js
// Node.js + Express API Server
// Connects to Railway MySQL and serves all ChronoGrid data
// ================================================================

require('dotenv').config();
const express = require('express');
const mysql2  = require('mysql2/promise');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── DB CONNECTION POOL ──────────────────────────────────────────
const pool = mysql2.createPool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    10,
  ssl: { rejectUnauthorized: false }
});

// Test DB connection on startup
pool.getConnection()
  .then(conn => { console.log('✅ MySQL connected successfully'); conn.release(); })
  .catch(err => console.error('❌ MySQL connection failed:', err.message));

// ── HELPER ──────────────────────────────────────────────────────
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// ================================================================
// AUTH ROUTES
// ================================================================

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if(!email || !password || !role)
      return res.status(400).json({ error: 'Email, password and role required' });

    let user = null;

    if(role === 'admin') {
      const rows = await query(
        'SELECT id, name, email, phone, gender, dob, "admin" AS role FROM admins WHERE email=? AND password=?',
        [email, password]
      );
      if(rows.length) user = rows[0];

    } else if(role === 'faculty') {
      const rows = await query(
        `SELECT f.id, f.faculty_name AS name, f.email, f.password, f.department AS dept,
                f.designation AS desig, f.gender, f.phone, f.dob, f.experience AS exp,
                f.qualification AS qual, f.specialization AS spec, f.photo,
                "faculty" AS role
         FROM faculty f WHERE f.email=? AND f.password=?`,
        [email, password]
      );
      if(rows.length) {
        user = rows[0];
        // Get subjects taught
        user.subs = (await query(
          `SELECT s.subject_code AS id FROM faculty_subjects fs
           JOIN subjects s ON fs.subject_id = s.id
           WHERE fs.faculty_id = ?`, [user.id]
        )).map(r => r.id);
        // Get sections assigned
        user.sections = (await query(
          `SELECT CONCAT(b.branch_code, '-', sec.section_name) AS secId
           FROM faculty_sections fs
           JOIN sections sec ON fs.section_id = sec.id
           JOIN branches b   ON sec.branch_id = b.id
           WHERE fs.faculty_id = ?`, [user.id]
        )).map(r => r.secId);
      }

    } else if(role === 'student') {
      const rows = await query(
        `SELECT st.id, st.student_name AS name, st.email, st.roll_number AS rollNo,
                st.gender, st.phone, st.dob, st.address, st.photo,
                b.branch_code AS branch, sec.section_name AS section,
                CONCAT(b.branch_code, '-', sec.section_name) AS secId,
                sec.semester, "student" AS role
         FROM students st
         JOIN sections sec ON st.section_id = sec.id
         JOIN branches b   ON sec.branch_id = b.id
         WHERE st.email=? AND st.password=?`,
        [email, password]
      );
      if(rows.length) user = rows[0];
    }

    if(!user) return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ success: true, user });

  } catch(err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ================================================================
// STUDENT ROUTES
// ================================================================

// GET /api/students — all students with branch/section info
app.get('/api/students', async (req, res) => {
  try {
    const rows = await query(`
      SELECT st.id, st.student_name AS name, st.roll_number AS rollNo,
             st.email, st.gender, st.phone, st.dob, st.address, st.photo,
             b.branch_code AS branch, sec.section_name AS section,
             CONCAT(b.branch_code,'-',sec.section_name) AS secId,
             sec.semester, sec.id AS section_id
      FROM students st
      JOIN sections sec ON st.section_id = sec.id
      JOIN branches b   ON sec.branch_id = b.id
      ORDER BY b.branch_code, sec.section_name, st.roll_number
    `);
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/students/:id
app.get('/api/students/:id', async (req, res) => {
  try {
    const rows = await query(`
      SELECT st.id, st.student_name AS name, st.roll_number AS rollNo,
             st.email, st.gender, st.phone, st.dob, st.address, st.photo,
             b.branch_code AS branch, sec.section_name AS section,
             CONCAT(b.branch_code,'-',sec.section_name) AS secId, sec.semester
      FROM students st
      JOIN sections sec ON st.section_id = sec.id
      JOIN branches b   ON sec.branch_id = b.id
      WHERE st.id = ?`, [req.params.id]);
    if(!rows.length) return res.status(404).json({ error: 'Student not found' });
    res.json(rows[0]);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/students — add new student
app.post('/api/students', async (req, res) => {
  try {
    const { name, rollNo, email, password, section_id, gender, phone, dob, address } = req.body;
    if(!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const result = await query(
      `INSERT INTO students (student_name, roll_number, email, password, section_id, gender, phone, dob, address)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [name, rollNo||null, email, password||'student@123', section_id||null, gender||null, phone||null, dob||null, address||null]
    );
    res.json({ success: true, id: result.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/students/:id — update student
app.put('/api/students/:id', async (req, res) => {
  try {
    const { name, rollNo, email, gender, phone, dob, address, section_id, photo } = req.body;
    await query(
      `UPDATE students SET student_name=?, roll_number=?, email=?, gender=?,
       phone=?, dob=?, address=?, section_id=?, photo=? WHERE id=?`,
      [name, rollNo||null, email, gender||null, phone||null, dob||null, address||null, section_id||null, photo||null, req.params.id]
    );
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/students/:id
app.delete('/api/students/:id', async (req, res) => {
  try {
    await query('DELETE FROM students WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// FACULTY ROUTES
// ================================================================

// GET /api/faculty
app.get('/api/faculty', async (req, res) => {
  try {
    const faculty = await query(`
      SELECT id, faculty_name AS name, email, department AS dept,
             designation AS desig, gender, phone, dob, experience AS exp,
             qualification AS qual, specialization AS spec, photo
      FROM faculty ORDER BY id
    `);
    // Attach subjects and sections to each faculty
    for(const f of faculty) {
      f.subs = (await query(
        `SELECT s.subject_code AS id FROM faculty_subjects fs
         JOIN subjects s ON fs.subject_id = s.id WHERE fs.faculty_id=?`, [f.id]
      )).map(r => r.id);
      f.sections = (await query(
        `SELECT CONCAT(b.branch_code,'-',sec.section_name) AS secId
         FROM faculty_sections fs
         JOIN sections sec ON fs.section_id = sec.id
         JOIN branches b   ON sec.branch_id = b.id
         WHERE fs.faculty_id=?`, [f.id]
      )).map(r => r.secId);
    }
    res.json(faculty);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/faculty — add new faculty
app.post('/api/faculty', async (req, res) => {
  try {
    const { name, email, password, dept, desig, gender, phone, qual, spec } = req.body;
    if(!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const result = await query(
      `INSERT INTO faculty (faculty_name, email, password, department, designation, gender, phone, qualification, specialization)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [name, email, password||'faculty@123', dept||null, desig||null, gender||null, phone||null, qual||null, spec||null]
    );
    res.json({ success: true, id: result.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/faculty/:id
app.put('/api/faculty/:id', async (req, res) => {
  try {
    const { name, email, dept, desig, gender, phone, qual, spec, exp, photo } = req.body;
    await query(
      `UPDATE faculty SET faculty_name=?, email=?, department=?, designation=?,
       gender=?, phone=?, qualification=?, specialization=?, experience=?, photo=? WHERE id=?`,
      [name, email, dept||null, desig||null, gender||null, phone||null, qual||null, spec||null, exp||0, photo||null, req.params.id]
    );
    // Update subjects
    if(req.body.subs) {
      await query('DELETE FROM faculty_subjects WHERE faculty_id=?', [req.params.id]);
      for(const code of req.body.subs) {
        const s = await query('SELECT id FROM subjects WHERE subject_code=?', [code]);
        if(s.length) await query('INSERT INTO faculty_subjects (faculty_id,subject_id) VALUES (?,?)', [req.params.id, s[0].id]);
      }
    }
    // Update sections
    if(req.body.sections) {
      await query('DELETE FROM faculty_sections WHERE faculty_id=?', [req.params.id]);
      for(const secId of req.body.sections) {
        const [bc, sn] = secId.split('-');
        const s = await query(
          `SELECT sec.id FROM sections sec JOIN branches b ON sec.branch_id=b.id
           WHERE b.branch_code=? AND sec.section_name=?`, [bc, sn]
        );
        if(s.length) await query('INSERT INTO faculty_sections (faculty_id,section_id) VALUES (?,?)', [req.params.id, s[0].id]);
      }
    }
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/faculty/:id
app.delete('/api/faculty/:id', async (req, res) => {
  try {
    await query('DELETE FROM faculty WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// BRANCHES, SECTIONS, ROOMS, SUBJECTS
// ================================================================

// GET /api/branches
app.get('/api/branches', async (req, res) => {
  try {
    const rows = await query('SELECT id, branch_code AS id2, branch_code, branch_name AS name, color FROM branches');
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/branches
app.post('/api/branches', async (req, res) => {
  try {
    const { branch_code, name, color } = req.body;
    const result = await query('INSERT INTO branches (branch_code, branch_name, color) VALUES (?,?,?)', [branch_code, name, color||'#3b82f6']);
    res.json({ success: true, id: result.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/branches/:id
app.put('/api/branches/:id', async (req, res) => {
  try {
    const { name, color } = req.body;
    await query('UPDATE branches SET branch_name=?, color=? WHERE id=?', [name, color, req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/branches/:id
app.delete('/api/branches/:id', async (req, res) => {
  try {
    await query('DELETE FROM branches WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sections
app.get('/api/sections', async (req, res) => {
  try {
    const rows = await query(`
      SELECT sec.id, b.branch_code AS branch, sec.section_name AS sec,
             CONCAT(b.branch_code,'-',sec.section_name) AS secId,
             sec.semester, sec.academic_year,
             r1.room_id AS room, r2.room_id AS labRoom,
             r1.id AS classroom_id, r2.id AS lab_room_id
      FROM sections sec
      JOIN branches b     ON sec.branch_id    = b.id
      LEFT JOIN rooms r1  ON sec.classroom_id = r1.id
      LEFT JOIN rooms r2  ON sec.lab_room_id  = r2.id
      ORDER BY b.branch_code, sec.section_name
    `);
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sections
app.post('/api/sections', async (req, res) => {
  try {
    const { branch_id, section_name, classroom_id, lab_room_id } = req.body;
    const result = await query(
      'INSERT INTO sections (branch_id, section_name, semester, academic_year, classroom_id, lab_room_id) VALUES (?,?,6,"2024-25",?,?)',
      [branch_id, section_name, classroom_id||null, lab_room_id||null]
    );
    res.json({ success: true, id: result.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/sections/:id
app.put('/api/sections/:id', async (req, res) => {
  try {
    const { classroom_id, lab_room_id } = req.body;
    await query('UPDATE sections SET classroom_id=?, lab_room_id=? WHERE id=?', [classroom_id||null, lab_room_id||null, req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/sections/:id
app.delete('/api/sections/:id', async (req, res) => {
  try {
    await query('DELETE FROM sections WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const rows = await query('SELECT id, room_id, room_name AS name, room_type AS type, capacity AS cap, building AS bldg, floor FROM rooms ORDER BY room_type, room_id');
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/rooms
app.post('/api/rooms', async (req, res) => {
  try {
    const { room_id, name, type, cap, bldg, floor } = req.body;
    const result = await query(
      'INSERT INTO rooms (room_id, room_name, room_type, capacity, building, floor) VALUES (?,?,?,?,?,?)',
      [room_id, name, type||'classroom', cap||60, bldg||null, floor||1]
    );
    res.json({ success: true, id: result.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/rooms/:id
app.put('/api/rooms/:id', async (req, res) => {
  try {
    const { name, type, cap, bldg, floor } = req.body;
    await query('UPDATE rooms SET room_name=?, room_type=?, capacity=?, building=?, floor=? WHERE id=?',
      [name, type, cap, bldg, floor, req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/rooms/:id
app.delete('/api/rooms/:id', async (req, res) => {
  try {
    await query('DELETE FROM rooms WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/subjects
app.get('/api/subjects', async (req, res) => {
  try {
    const subjects = await query(`
      SELECT id, subject_code AS code, subject_name AS name,
             subject_type AS type, credits, periods_per_week AS ppw, color
      FROM subjects ORDER BY subject_code
    `);
    for(const s of subjects) {
      s.branches = (await query(
        `SELECT b.branch_code FROM subject_branches sb JOIN branches b ON sb.branch_id=b.id WHERE sb.subject_id=?`,
        [s.id]
      )).map(r => r.branch_code);
      s.branch = s.branches[0] || null;
    }
    res.json(subjects);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/subjects
app.post('/api/subjects', async (req, res) => {
  try {
    const { code, name, type, credits, ppw, color, branches } = req.body;
    if(!code || !name) return res.status(400).json({ error: 'Code and name required' });
    const result = await query(
      'INSERT INTO subjects (subject_code, subject_name, subject_type, credits, periods_per_week, color) VALUES (?,?,?,?,?,?)',
      [code, name, type||'theory', credits||3, ppw||3, color||'#3b82f6']
    );
    const subId = result.insertId;
    if(branches && branches.length) {
      for(const bc of branches) {
        const b = await query('SELECT id FROM branches WHERE branch_code=?', [bc]);
        if(b.length) await query('INSERT INTO subject_branches (subject_id, branch_id) VALUES (?,?)', [subId, b[0].id]);
      }
    }
    res.json({ success: true, id: subId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/subjects/:id
app.put('/api/subjects/:id', async (req, res) => {
  try {
    const { name, type, credits, ppw, color, branches } = req.body;
    await query(
      'UPDATE subjects SET subject_name=?, subject_type=?, credits=?, periods_per_week=?, color=? WHERE id=?',
      [name, type, credits, ppw, color, req.params.id]
    );
    if(branches) {
      await query('DELETE FROM subject_branches WHERE subject_id=?', [req.params.id]);
      for(const bc of branches) {
        const b = await query('SELECT id FROM branches WHERE branch_code=?', [bc]);
        if(b.length) await query('INSERT INTO subject_branches (subject_id, branch_id) VALUES (?,?)', [req.params.id, b[0].id]);
      }
    }
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/subjects/:id
app.delete('/api/subjects/:id', async (req, res) => {
  try {
    await query('DELETE FROM subjects WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// TIMETABLE ROUTES
// ================================================================

// GET /api/timetable/:secId  (e.g. CSE-A)
app.get('/api/timetable/:secId', async (req, res) => {
  try {
    const [bc, sn] = req.params.secId.split('-');
    const rows = await query(`
      SELECT t.id, t.day, t.start_time, t.end_time, t.slot_type AS type,
             s.subject_code AS subId, s.subject_name AS subName, s.color,
             f.id AS facId, f.faculty_name AS facName,
             r.room_id AS roomId, r.room_name AS roomName, r.building AS bldg, r.floor
      FROM timetable t
      JOIN sections sec ON t.section_id = sec.id
      JOIN branches b   ON sec.branch_id = b.id
      JOIN subjects s   ON t.subject_id  = s.id
      JOIN faculty f    ON t.faculty_id  = f.id
      JOIN rooms r      ON t.room_id     = r.id
      WHERE b.branch_code=? AND sec.section_name=?
      ORDER BY FIELD(t.day,'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'), t.start_time
    `, [bc, sn]);
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/timetable/faculty/:facId
app.get('/api/timetable/faculty/:facId', async (req, res) => {
  try {
    const rows = await query(`
      SELECT t.id, t.day, t.start_time, t.end_time, t.slot_type AS type,
             s.subject_code AS subId, s.subject_name AS subName, s.color,
             CONCAT(b.branch_code,'-',sec.section_name) AS secId,
             r.room_id AS roomId, r.room_name AS roomName, r.building AS bldg, r.floor
      FROM timetable t
      JOIN sections sec ON t.section_id = sec.id
      JOIN branches b   ON sec.branch_id = b.id
      JOIN subjects s   ON t.subject_id  = s.id
      JOIN rooms r      ON t.room_id     = r.id
      WHERE t.faculty_id=?
      ORDER BY FIELD(t.day,'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'), t.start_time
    `, [req.params.facId]);
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/timetable — add timetable slot
app.post('/api/timetable', async (req, res) => {
  try {
    const { section_id, subject_id, faculty_id, room_id, day, start_time, end_time, slot_type } = req.body;
    const result = await query(
      'INSERT INTO timetable (section_id,subject_id,faculty_id,room_id,day,start_time,end_time,slot_type) VALUES (?,?,?,?,?,?,?,?)',
      [section_id, subject_id, faculty_id, room_id, day, start_time, end_time, slot_type||'theory']
    );
    res.json({ success: true, id: result.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/timetable/:id
app.delete('/api/timetable/:id', async (req, res) => {
  try {
    await query('DELETE FROM timetable WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/timetable/generate/:secId — replace all slots for a section
app.post('/api/timetable/generate/:secId', async (req, res) => {
  try {
    const [bc, sn] = req.params.secId.split('-');
    const sec = await query(
      `SELECT sec.id FROM sections sec JOIN branches b ON sec.branch_id=b.id
       WHERE b.branch_code=? AND sec.section_name=?`, [bc, sn]
    );
    if(!sec.length) return res.status(404).json({ error: 'Section not found' });
    const secDbId = sec[0].id;
    await query('DELETE FROM timetable WHERE section_id=?', [secDbId]);
    const { slots } = req.body; // array of slot objects
    for(const slot of slots) {
      await query(
        'INSERT INTO timetable (section_id,subject_id,faculty_id,room_id,day,start_time,end_time,slot_type) VALUES (?,?,?,?,?,?,?,?)',
        [secDbId, slot.subject_id, slot.faculty_id, slot.room_id, slot.day, slot.start_time, slot.end_time, slot.slot_type||'theory']
      );
    }
    res.json({ success: true, inserted: slots.length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// ATTENDANCE ROUTES
// ================================================================

// GET /api/attendance/summary/:studentId
app.get('/api/attendance/summary/:studentId', async (req, res) => {
  try {
    const rows = await query(`
      SELECT s.subject_code AS subjectId, s.subject_name AS subjectName,
             COUNT(*) AS total,
             SUM(CASE WHEN a.status='Present' THEN 1 ELSE 0 END) AS present,
             SUM(CASE WHEN a.status='Absent'  THEN 1 ELSE 0 END) AS absent
      FROM attendance a
      JOIN subjects s ON a.subject_id = s.id
      WHERE a.student_id = ?
      GROUP BY a.subject_id, s.subject_code, s.subject_name
    `, [req.params.studentId]);
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// GET /api/attendance/section/:secId/:subjectCode/:date
app.get('/api/attendance/section/:secId/:subjectCode/:date', async (req, res) => {
  try {
    const [bc, sn] = req.params.secId.split('-');
    const rows = await query(`
      SELECT st.id AS studentId, st.student_name AS name, a.status
      FROM students st
      JOIN sections sec ON st.section_id = sec.id
      JOIN branches b   ON sec.branch_id  = b.id
      LEFT JOIN attendance a ON a.student_id = st.id
        AND a.subject_id = (SELECT id FROM subjects WHERE subject_code=?)
        AND a.date = ?
      WHERE b.branch_code=? AND sec.section_name=?
      ORDER BY st.roll_number
    `, [req.params.subjectCode, req.params.date, bc, sn]);
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/attendance — submit attendance for a session
app.post('/api/attendance', async (req, res) => {
  try {
    const { secId, subjectCode, date, attendance, markedBy } = req.body;
    // Get subject id
    const sub = await query('SELECT id FROM subjects WHERE subject_code=?', [subjectCode]);
    if(!sub.length) return res.status(404).json({ error: 'Subject not found' });
    const subDbId = sub[0].id;
    // Delete existing records for this date/subject/section
    const [bc, sn] = secId.split('-');
    await query(`
      DELETE a FROM attendance a
      JOIN students st ON a.student_id = st.id
      JOIN sections sec ON st.section_id = sec.id
      JOIN branches b ON sec.branch_id = b.id
      WHERE b.branch_code=? AND sec.section_name=? AND a.subject_id=? AND a.date=?
    `, [bc, sn, subDbId, date]);
    // Insert new records
    for(const [studentId, status] of Object.entries(attendance)) {
      await query(
        'INSERT INTO attendance (student_id, subject_id, date, status, marked_by) VALUES (?,?,?,?,?)',
        [studentId, subDbId, date, status, markedBy||null]
      );
    }
    res.json({ success: true, count: Object.keys(attendance).length });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// ANNOUNCEMENTS ROUTES
// ================================================================

// GET /api/announcements
app.get('/api/announcements', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM announcements ORDER BY date DESC');
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/announcements
app.post('/api/announcements', async (req, res) => {
  try {
    const { title, body, author, type, priority, branches } = req.body;
    const result = await query(
      'INSERT INTO announcements (title, body, author, date, type, priority, branches) VALUES (?,?,?,CURDATE(),?,?,?)',
      [title, body, author, type||'general', priority||'medium', Array.isArray(branches)?branches.join(','):branches||'CSE,IT,CST']
    );
    res.json({ success: true, id: result.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/announcements/:id
app.delete('/api/announcements/:id', async (req, res) => {
  try {
    await query('DELETE FROM announcements WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// EXAM SCHEDULE
// ================================================================

// GET /api/exams/:branchCode
app.get('/api/exams/:branchCode', async (req, res) => {
  try {
    const rows = await query(`
      SELECT e.id, s.subject_code AS subId, s.subject_name AS name,
             e.exam_date AS date, e.start_time AS time, e.venue, e.duration, e.branch_code AS branch
      FROM exam_schedule e
      JOIN subjects s ON e.subject_id = s.id
      WHERE e.branch_code=?
      ORDER BY e.exam_date
    `, [req.params.branchCode]);
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// PERIOD CONFIG
// ================================================================

// GET /api/periods
app.get('/api/periods', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM period_config ORDER BY period_number');
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/periods — save all periods at once
app.put('/api/periods', async (req, res) => {
  try {
    const { periods } = req.body;
    await query('DELETE FROM period_config');
    for(const p of periods) {
      await query(
        'INSERT INTO period_config (period_number, start_time, end_time, label) VALUES (?,?,?,?)',
        [p.period_number, p.start_time, p.end_time, p.label||null]
      );
    }
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// LEAVE REQUESTS
// ================================================================

// GET /api/leaves/:facultyId
app.get('/api/leaves/:facultyId', async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM leave_requests WHERE faculty_id=? ORDER BY created_at DESC',
      [req.params.facultyId]
    );
    res.json(rows);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leaves
app.post('/api/leaves', async (req, res) => {
  try {
    const { faculty_id, from_date, to_date, reason } = req.body;
    const result = await query(
      'INSERT INTO leave_requests (faculty_id, from_date, to_date, reason) VALUES (?,?,?,?)',
      [faculty_id, from_date, to_date, reason]
    );
    res.json({ success: true, id: result.insertId });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/leaves/:id/status — approve or reject
app.put('/api/leaves/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await query('UPDATE leave_requests SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ success: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// HEALTH CHECK
// ================================================================
app.get('/', (req, res) => {
  res.json({
    status: 'ChronoGrid API running',
    version: '1.0',
    endpoints: [
      'POST /api/login',
      'GET/POST/PUT/DELETE /api/students',
      'GET/POST/PUT/DELETE /api/faculty',
      'GET/POST/PUT/DELETE /api/branches',
      'GET/POST/PUT/DELETE /api/sections',
      'GET/POST/PUT/DELETE /api/rooms',
      'GET/POST/PUT/DELETE /api/subjects',
      'GET /api/timetable/:secId',
      'GET /api/timetable/faculty/:facId',
      'POST /api/timetable/generate/:secId',
      'GET /api/attendance/summary/:studentId',
      'GET /api/attendance/section/:secId/:subjectCode/:date',
      'POST /api/attendance',
      'GET/POST/DELETE /api/announcements',
      'GET /api/exams/:branchCode',
      'GET/PUT /api/periods',
      'GET/POST /api/leaves/:facultyId',
    ]
  });
});

// ================================================================
// START SERVER
// ================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ChronoGrid API running on http://localhost:${PORT}`);
});
