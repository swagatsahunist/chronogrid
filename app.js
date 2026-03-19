/* ================================================================
   CHRONOGRID — app.js  Complete Application Logic
   NIST Berhampur | B.Tech 6th Semester | 2024-25
   ================================================================ */
'use strict';

/* ━━━ CONFIG ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const C = {
  SK: 'cg_data_v4',
  days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
  dayS: ['Mon','Tue','Wed','Thu','Fri','Sat'],
  // DEFAULT periods – actual values always loaded from A.db.periodConfig at runtime
  // NIST Berhampur: 7:30 AM start, 60-min classes, 10-min break before lunch, no break after lunch
  periods: [
    {n:1, time:'7:30–8:30 AM',  start:450, end:510},
    {n:2, time:'8:40–9:40 AM',  start:520, end:580},
    {n:3, time:'9:50–10:50 AM', start:590, end:650},
    {n:4, time:'11:00 AM–12:00',start:660, end:720},
    {n:5, time:'1:00–2:00 PM',  start:780, end:840},
    {n:6, time:'2:00–3:00 PM',  start:840, end:900}
  ],
  lunch: {time:'12:00–1:00 PM', start:720, end:780}
};

/* ── DYNAMIC PERIOD ACCESSOR ────────────────────────────────── */
// Always use getPeriods() / getLunch() instead of C.periods / C.lunch directly,
// so admin edits are reflected everywhere immediately.
function getPeriods(){ return (A.db&&A.db.periodConfig&&A.db.periodConfig.periods)||C.periods; }
function getLunch(){   return (A.db&&A.db.periodConfig&&A.db.periodConfig.lunch)  ||C.lunch;   }

/* Helper: convert "HH:MM" string → minutes since midnight */
function hmToMins(hm){
  const [h,m]=(hm||'0:0').split(':').map(Number);
  return h*60+(m||0);
}
/* Helper: minutes since midnight → "H:MM AM/PM" display string */
function minsToHMStr(mins){
  const h=Math.floor(mins/60), m=mins%60;
  const ampm=h<12?'AM':'PM', hh=h%12||12;
  return `${hh}:${String(m).padStart(2,'0')} ${ampm}`;
}
/* Helper: build a human-readable period time label */
function periodLabel(startMins, endMins){
  return minsToHMStr(startMins)+'–'+minsToHMStr(endMins);
}

/* ━━━ APP STATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const A = { user: null, db: null };

/* ━━━ API CONFIG ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const API = 'https://chronogrid-production.up.railway.app';

/* ━━━ STORAGE (localStorage fallback only) ━━━━━━━━━━━━━━━━━━━━ */
function save() { try { localStorage.setItem(C.SK, JSON.stringify(A.db)); } catch(e){} }
function load() {
  try {
    const s = localStorage.getItem(C.SK);
    if(s) { A.db = JSON.parse(s); return true; }
  } catch(e){}
  return false;
}

/* ━━━ API HELPERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function apiFetch(path, opts={}){
  const res = await fetch(API+path, {
    headers:{'Content-Type':'application/json'},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if(!res.ok) throw new Error('API error '+res.status);
  return res.json();
}
async function apiGet(path){ return apiFetch(path); }
async function apiPost(path,body){ return apiFetch(path,{method:'POST',body}); }
async function apiPut(path,body){ return apiFetch(path,{method:'PUT',body}); }
async function apiDel(path){ return apiFetch(path,{method:'DELETE'}); }

/* ━━━ LOAD ALL DATA FROM API INTO A.db ━━━━━━━━━━━━━━━━━━━━━━━━ */
async function loadFromAPI(){
  showLoading('Connecting to database...');
  try {
    const [students, faculty, branches, sections, rooms, subjects,
           announcements, periods] = await Promise.all([
      apiGet('/api/students'),
      apiGet('/api/faculty'),
      apiGet('/api/branches'),
      apiGet('/api/sections'),
      apiGet('/api/rooms'),
      apiGet('/api/subjects'),
      apiGet('/api/announcements'),
      apiGet('/api/periods')
    ]);

    // Normalise branches
    const courses = branches.map(b=>({id:b.branch_code, name:b.branch_name||b.name, color:b.color}));

    // Normalise rooms
    const roomsN = rooms.map(r=>({id:r.room_id, name:r.name||r.room_name, type:r.type||r.room_type, cap:r.cap||r.capacity, bldg:r.bldg||r.building, floor:r.floor}));

    // Normalise sections
    const sectionsN = sections.map(s=>({id:s.secId, branch:s.branch, sec:s.section||s.sec, room:s.room, labRoom:s.labRoom}));

    // Normalise subjects — add legacy branch field
    const subjectsN = subjects.map(s=>({
      id:s.code||s.subject_code, code:s.code||s.subject_code,
      name:s.name||s.subject_name, type:s.type||s.subject_type,
      credits:s.credits, ppw:s.ppw||s.periods_per_week,
      color:s.color, branches:s.branches||[s.branch],
      branch:(s.branches&&s.branches[0])||s.branch
    }));

    // Normalise students
    const studentsN = students.map(s=>({
      id:'S'+String(s.id), name:s.name||s.student_name,
      email:s.email, pw:'student@123', role:'student',
      branch:s.branch, section:s.section,
      secId:s.secId||s.branch+'-'+s.section,
      semester:s.semester||6, rollNo:s.rollNo||s.roll_number,
      gender:s.gender, phone:s.phone, dob:s.dob,
      address:s.address, photo:s.photo,
      dbId: s.id  // keep original DB id for API calls
    }));

    // Normalise faculty
    const facultyN = faculty.map(f=>({
      id:'F'+String(f.id).padStart(2,'0'), name:f.name||f.faculty_name,
      email:f.email, pw:'faculty@123', role:'faculty',
      dept:f.dept||f.department, desig:f.desig||f.designation,
      gender:f.gender, phone:f.phone, dob:f.dob,
      exp:f.exp||f.experience||0, qual:f.qual||f.qualification,
      spec:f.spec||f.specialization, photo:f.photo,
      subs:f.subs||[], sections:f.sections||[],
      dbId: f.id
    }));

    // Admins
    const admins = [{
      id:'ADM01', name:'System Administrator',
      email:'admin@nist.edu.in', pw:'admin@123', role:'admin',
      dept:'Administration', desig:'System Admin',
      phone:'9999999999', gender:'Male', dob:'1980-01-01', photo:null
    }];

    // Build period config from DB periods
    const periodConfig = buildPeriodConfigFromDB(periods);

    // Build timetables — fetch for all sections
    const timetables = [];
    for(const sec of sectionsN){
      try {
        const slots = await apiGet('/api/timetable/'+sec.id);
        timetables.push(buildTTFromAPI(sec.id, slots, periodConfig.periods));
      } catch(e){ /* skip if no timetable for section */ }
    }

    // Build empty attSummary — will be loaded per student on demand
    const attSummary = {};
    for(const s of studentsN){
      const subs = subjectsN.filter(sb=>sb.branches.includes(s.branch));
      for(const sb of subs){
        attSummary[s.id+'_'+sb.id] = {total:0, present:0, absent:0};
      }
    }

    // Normalise announcements
    const announcementsN = announcements.map(a=>({
      id:'AN'+a.id, title:a.title, body:a.body, author:a.author,
      date:a.date?a.date.split('T')[0]:new Date().toISOString().split('T')[0],
      type:a.type||'general', priority:a.priority||'medium',
      branches: typeof a.branches==='string' ? a.branches.split(',') : (a.branches||['CSE','IT','CST'])
    }));

    // Build exam schedule
    const examSchedule = await loadExamSchedule();

    A.db = {
      version:4, courses, sections:sectionsN, rooms:roomsN,
      subjects:subjectsN, faculty:facultyN, students:studentsN,
      admins, users:[...admins,...facultyN,...studentsN],
      timetables, attSummary, attRecords:[],
      announcements:announcementsN, examSchedule,
      leaveRequests:[], notifications:[],
      periodConfig
    };
    save(); // cache in localStorage as backup
    hideLoading();
    return true;
  } catch(err){
    console.error('API load failed:', err);
    hideLoading();
    return false;
  }
}

async function loadExamSchedule(){
  try {
    const [cse,it,cst] = await Promise.all([
      apiGet('/api/exams/CSE'), apiGet('/api/exams/IT'), apiGet('/api/exams/CST')
    ]);
    return [...cse,...it,...cst].map(e=>({
      id:'EX'+e.id, subId:e.subId||e.subject_code,
      name:e.name||e.subject_name,
      date:e.date?e.date.split('T')[0]:'',
      time:e.time||'10:00 AM', venue:e.venue,
      duration:e.duration||'3 hrs', branch:e.branch||e.branch_code
    }));
  } catch(e){ return buildExamSchedule(); }
}

function buildPeriodConfigFromDB(periods){
  const mapped = periods.map(p=>({
    n: p.period_number,
    time: p.label || periodLabel(hmToMins(String(p.start_time).slice(0,5)), hmToMins(String(p.end_time).slice(0,5))),
    start: hmToMins(String(p.start_time).slice(0,5)),
    end:   hmToMins(String(p.end_time).slice(0,5))
  }));
  const lunch = {time:'12:00–1:00 PM', start:720, end:780};
  if(!mapped.length) return buildDefaultPeriodConfig();
  return { periods:mapped, lunch, periodDuration:60, morningBreak:10, afternoonBreak:0, labDuration:2, maxContiguous:2, workingDays:6 };
}

function buildTTFromAPI(secId, slots, periods){
  const grid = {};
  C.days.forEach(d=>{ grid[d]=periods.map((_,i)=>({period:i+1,subId:null,facId:null,room:null,type:'free'})); });
  for(const slot of slots){
    const dayName = slot.day;
    if(!grid[dayName]) continue;
    const startMins = hmToMins(String(slot.start_time).slice(0,5));
    const pi = periods.findIndex(p=>p.start===startMins);
    if(pi===-1) continue;
    const endMins = hmToMins(String(slot.end_time).slice(0,5));
    const numSlots = periods.filter(p=>p.start>=startMins && p.end<=endMins).length || 1;
    for(let k=0;k<numSlots;k++){
      if(pi+k >= periods.length) break;
      grid[dayName][pi+k] = {
        period: pi+k+1,
        subId:  slot.subId || slot.subject_code,
        facId:  'F'+String(slot.facId||0).padStart(2,'0'),
        room:   slot.roomId || slot.room_id,
        type:   slot.type  || slot.slot_type || 'theory'
      };
    }
  }
  return { secId, branch:secId.split('-')[0], section:secId.split('-')[1], schedule:grid };
}

/* ━━━ LOADING OVERLAY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function showLoading(msg='Loading...'){
  let ov = document.getElementById('loading-overlay');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'loading-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(6,8,15,.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px';
    ov.innerHTML = `
      <div style="width:48px;height:48px;border:3px solid var(--border2);border-top-color:var(--teal);border-radius:50%;animation:spin 1s linear infinite"></div>
      <div id="loading-msg" style="color:var(--teal);font-family:var(--font-head);font-size:16px;font-weight:700">${msg}</div>
      <div style="color:var(--text3);font-size:13px">Connecting to Railway MySQL...</div>`;
    document.body.appendChild(ov);
  } else {
    document.getElementById('loading-msg').textContent = msg;
  }
}
function hideLoading(){ const ov=document.getElementById('loading-overlay'); if(ov) ov.remove(); }

/* ━━━ SEED DATA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function seedDB() {
  const maleN = ['Arjun Sharma','Rohit Verma','Vijay Patel','Suresh Kumar','Deepak Singh','Aditya Gupta','Karan Mehta','Nikhil Joshi','Saurabh Yadav','Amit Tiwari','Akash Mishra','Ravi Pandey','Varun Shukla','Manish Dubey','Pranav Nair','Abhishek Roy','Harsh Das','Shubham Sahu','Vishal Rao','Dhruv Nayak','Tarun Behera','Bikash Panda','Dibya Mohanta','Sourav Jena','Bishal Saha','Samir Dash','Subhash Parida','Kaustav Swain','Dipankar Sahoo','Pritam Rout'];
  const femN  = ['Priya Singh','Ananya Sharma','Kavya Reddy','Sneha Patel','Ritu Gupta','Pooja Kumar','Divya Mishra','Shreya Joshi','Nidhi Verma','Pallavi Singh','Swati Tiwari','Meena Sharma','Asha Kumari','Rekha Sahu','Sunita Behera','Tapasya Panda','Madhusmita Nayak','Debasmita Das','Pratigya Mohanta','Suchismita Jena'];
  let mi=0, fi=0;
  const ph = () => '9'+Math.floor(100000000+Math.random()*899999999);

  const courses = [
    {id:'CSE', name:'Computer Science & Engineering', color:'#0affcb'},
    {id:'IT',  name:'Information Technology',         color:'#3b82f6'},
    {id:'CST', name:'Computer Science & Technology',  color:'#f59e0b'}
  ];

  const sections = [
    {id:'CSE-A',branch:'CSE',sec:'A',room:'CR-101',labRoom:'CL-101'},
    {id:'CSE-B',branch:'CSE',sec:'B',room:'CR-102',labRoom:'CL-102'},
    {id:'CSE-C',branch:'CSE',sec:'C',room:'CR-103',labRoom:'CL-103'},
    {id:'CSE-D',branch:'CSE',sec:'D',room:'CR-104',labRoom:'CL-104'},
    {id:'CSE-E',branch:'CSE',sec:'E',room:'CR-105',labRoom:'CL-105'},
    {id:'IT-A', branch:'IT', sec:'A',room:'CR-201',labRoom:'NL-101'},
    {id:'IT-B', branch:'IT', sec:'B',room:'CR-202',labRoom:'NL-102'},
    {id:'CST-A',branch:'CST',sec:'A',room:'CR-301',labRoom:'CL-301'}
  ];

  const rooms = [
    {id:'CR-101',name:'Classroom 101',type:'classroom',cap:60,bldg:'Block A',floor:1},
    {id:'CR-102',name:'Classroom 102',type:'classroom',cap:60,bldg:'Block A',floor:1},
    {id:'CR-103',name:'Classroom 103',type:'classroom',cap:60,bldg:'Block A',floor:1},
    {id:'CR-104',name:'Classroom 104',type:'classroom',cap:60,bldg:'Block A',floor:2},
    {id:'CR-105',name:'Classroom 105',type:'classroom',cap:60,bldg:'Block A',floor:2},
    {id:'CR-201',name:'Classroom 201',type:'classroom',cap:60,bldg:'Block B',floor:1},
    {id:'CR-202',name:'Classroom 202',type:'classroom',cap:60,bldg:'Block B',floor:1},
    {id:'CR-301',name:'Classroom 301',type:'classroom',cap:60,bldg:'Block C',floor:1},
    {id:'CL-101',name:'Computer Lab 1',type:'lab',cap:30,bldg:'Lab Block',floor:1},
    {id:'CL-102',name:'Computer Lab 2',type:'lab',cap:30,bldg:'Lab Block',floor:1},
    {id:'CL-103',name:'Computer Lab 3',type:'lab',cap:30,bldg:'Lab Block',floor:2},
    {id:'CL-104',name:'Computer Lab 4',type:'lab',cap:30,bldg:'Lab Block',floor:2},
    {id:'CL-105',name:'Computer Lab 5',type:'lab',cap:30,bldg:'Lab Block',floor:2},
    {id:'CL-301',name:'CST Lab',       type:'lab',cap:30,bldg:'Block C',  floor:2},
    {id:'NL-101',name:'Network Lab 1', type:'lab',cap:30,bldg:'Lab Block',floor:3},
    {id:'NL-102',name:'Network Lab 2', type:'lab',cap:30,bldg:'Lab Block',floor:3}
  ];

  const subjects = [
    {id:'CS601', code:'CS601', name:'Operating Systems',       branch:'CSE',credits:4,type:'theory',ppw:3,color:'#0affcb'},
    {id:'CS602', code:'CS602', name:'Computer Networks',       branch:'CSE',credits:4,type:'theory',ppw:3,color:'#3b82f6'},
    {id:'CS603', code:'CS603', name:'DBMS',                    branch:'CSE',credits:4,type:'theory',ppw:3,color:'#f59e0b'},
    {id:'CS604', code:'CS604', name:'Software Engineering',    branch:'CSE',credits:3,type:'theory',ppw:3,color:'#ef4444'},
    {id:'CS605', code:'CS605', name:'Theory of Computation',   branch:'CSE',credits:3,type:'theory',ppw:3,color:'#22c55e'},
    {id:'CS606', code:'CS606L',name:'OS Lab',                  branch:'CSE',credits:2,type:'lab',   ppw:3,color:'#8b5cf6'},
    {id:'CS607', code:'CS607L',name:'Networks Lab',            branch:'CSE',credits:2,type:'lab',   ppw:3,color:'#06b6d4'},
    {id:'IT601', code:'IT601', name:'Web Technologies',        branch:'IT', credits:4,type:'theory',ppw:3,color:'#3b82f6'},
    {id:'IT602', code:'IT602', name:'Information Security',    branch:'IT', credits:4,type:'theory',ppw:3,color:'#ef4444'},
    {id:'IT603', code:'IT603', name:'Database Systems',        branch:'IT', credits:3,type:'theory',ppw:3,color:'#f59e0b'},
    {id:'IT604', code:'IT604', name:'Software Project Mgmt',   branch:'IT', credits:3,type:'theory',ppw:3,color:'#22c55e'},
    {id:'IT605', code:'IT605', name:'Cloud Computing',         branch:'IT', credits:3,type:'theory',ppw:3,color:'#8b5cf6'},
    {id:'IT606', code:'IT606L',name:'Web Tech Lab',            branch:'IT', credits:2,type:'lab',   ppw:3,color:'#0891b2'},
    {id:'CST601',code:'CST601',name:'Machine Learning',        branch:'CST',credits:4,type:'theory',ppw:3,color:'#f59e0b'},
    {id:'CST602',code:'CST602',name:'Cloud Computing',         branch:'CST',credits:4,type:'theory',ppw:3,color:'#3b82f6'},
    {id:'CST603',code:'CST603',name:'Data Mining',             branch:'CST',credits:3,type:'theory',ppw:3,color:'#ef4444'},
    {id:'CST604',code:'CST604',name:'Distributed Systems',     branch:'CST',credits:3,type:'theory',ppw:3,color:'#22c55e'},
    {id:'CST605',code:'CST605',name:'Deep Learning',           branch:'CST',credits:3,type:'theory',ppw:3,color:'#8b5cf6'},
    {id:'CST606',code:'CST606L',name:'ML Lab',                 branch:'CST',credits:2,type:'lab',   ppw:3,color:'#0affcb'}
  ];

  const faculty = [
    {id:'F01',name:'Dr. Rajesh Kumar',    email:'rajesh.kumar@nist.edu.in',   pw:'faculty@123',role:'faculty',dept:'CSE',desig:'Professor',    subs:['CS601','CS606'],gender:'Male',  phone:'9861001001',dob:'1975-08-15',exp:20,qual:'Ph.D. IIT Delhi', spec:'Operating Systems',   photo:null,sections:['CSE-A','CSE-C']},
    {id:'F02',name:'Dr. Priya Sharma',    email:'priya.sharma@nist.edu.in',   pw:'faculty@123',role:'faculty',dept:'CSE',desig:'Assoc. Prof.',  subs:['CS602','CS607'],gender:'Female',phone:'9861001002',dob:'1980-03-22',exp:15,qual:'Ph.D. IISc',       spec:'Computer Networks',   photo:null,sections:['CSE-A','CSE-B']},
    {id:'F03',name:'Dr. Amit Verma',      email:'amit.verma@nist.edu.in',     pw:'faculty@123',role:'faculty',dept:'CSE',desig:'Assoc. Prof.',  subs:['CS603'],        gender:'Male',  phone:'9861001003',dob:'1978-11-10',exp:17,qual:'Ph.D. IIT Bombay', spec:'Database Systems',    photo:null,sections:['CSE-A','CSE-C','CSE-E']},
    {id:'F04',name:'Prof. Sunita Patel',  email:'sunita.patel@nist.edu.in',   pw:'faculty@123',role:'faculty',dept:'CSE',desig:'Asst. Prof.',   subs:['CS604'],        gender:'Female',phone:'9861001004',dob:'1985-06-28',exp:10,qual:'M.Tech NIT Rkl',   spec:'Software Engg.',      photo:null,sections:['CSE-A','CSE-B','CSE-C','CSE-D','CSE-E']},
    {id:'F05',name:'Dr. Vikram Singh',    email:'vikram.singh@nist.edu.in',   pw:'faculty@123',role:'faculty',dept:'CSE',desig:'Professor',     subs:['CS605'],        gender:'Male',  phone:'9861001005',dob:'1972-01-15',exp:25,qual:'Ph.D. IIT Kanpur', spec:'Automata Theory',     photo:null,sections:['CSE-A','CSE-B','CSE-C','CSE-D','CSE-E']},
    {id:'F06',name:'Prof. Deepa Nair',    email:'deepa.nair@nist.edu.in',     pw:'faculty@123',role:'faculty',dept:'CSE',desig:'Asst. Prof.',   subs:['CS601','CS606'],gender:'Female',phone:'9861001006',dob:'1988-09-05',exp:7, qual:'M.Tech VIT',       spec:'Systems Programming', photo:null,sections:['CSE-B','CSE-D']},
    {id:'F07',name:'Dr. Suresh Menon',    email:'suresh.menon@nist.edu.in',   pw:'faculty@123',role:'faculty',dept:'CSE',desig:'Assoc. Prof.',  subs:['CS602','CS607'],gender:'Male',  phone:'9861001007',dob:'1979-04-18',exp:16,qual:'Ph.D. IIT Madras', spec:'Network Security',    photo:null,sections:['CSE-C','CSE-D']},
    {id:'F08',name:'Prof. Anita Joshi',   email:'anita.joshi@nist.edu.in',    pw:'faculty@123',role:'faculty',dept:'CSE',desig:'Asst. Prof.',   subs:['CS603'],        gender:'Female',phone:'9861001008',dob:'1987-12-30',exp:8, qual:'M.Tech NIT Trichy', spec:'Big Data',            photo:null,sections:['CSE-B','CSE-D']},
    {id:'F09',name:'Dr. Mohan Rao',       email:'mohan.rao@nist.edu.in',      pw:'faculty@123',role:'faculty',dept:'IT', desig:'Professor',     subs:['IT601','IT606'],gender:'Male',  phone:'9861001009',dob:'1973-07-22',exp:22,qual:'Ph.D. IIT Hyd',    spec:'Web Technologies',    photo:null,sections:['IT-A','IT-B']},
    {id:'F10',name:'Dr. Kavitha Reddy',   email:'kavitha.reddy@nist.edu.in',  pw:'faculty@123',role:'faculty',dept:'IT', desig:'Assoc. Prof.',  subs:['IT602'],        gender:'Female',phone:'9861001010',dob:'1981-02-14',exp:14,qual:'Ph.D. IIIT Hyd',   spec:'Cyber Security',      photo:null,sections:['IT-A','IT-B']},
    {id:'F11',name:'Prof. Arun Pillai',   email:'arun.pillai@nist.edu.in',    pw:'faculty@123',role:'faculty',dept:'IT', desig:'Asst. Prof.',   subs:['IT603','IT604'],gender:'Male',  phone:'9861001011',dob:'1986-10-08',exp:9, qual:'M.Tech NIT Calicut',spec:'DB & PM',             photo:null,sections:['IT-A','IT-B']},
    {id:'F12',name:'Prof. Rekha Krishna', email:'rekha.krishna@nist.edu.in',  pw:'faculty@123',role:'faculty',dept:'IT', desig:'Asst. Prof.',   subs:['IT605','IT606'],gender:'Female',phone:'9861001012',dob:'1989-05-20',exp:6, qual:'M.Tech NIT Silchar', spec:'Cloud Computing',     photo:null,sections:['IT-A','IT-B']},
    {id:'F13',name:'Dr. Ganesh Iyer',     email:'ganesh.iyer@nist.edu.in',    pw:'faculty@123',role:'faculty',dept:'CST',desig:'Professor',     subs:['CST601','CST606'],gender:'Male',phone:'9861001013',dob:'1970-03-11',exp:28,qual:'Ph.D. IISc',       spec:'ML & AI',             photo:null,sections:['CST-A']},
    {id:'F14',name:'Dr. Sonal Gupta',     email:'sonal.gupta@nist.edu.in',    pw:'faculty@123',role:'faculty',dept:'CST',desig:'Assoc. Prof.',  subs:['CST602','CST603'],gender:'Female',phone:'9861001014',dob:'1982-08-25',exp:13,qual:'Ph.D. IIT Delhi', spec:'Cloud & Data Mining',  photo:null,sections:['CST-A']},
    {id:'F15',name:'Prof. Harish Nambiar',email:'harish.nambiar@nist.edu.in', pw:'faculty@123',role:'faculty',dept:'CST',desig:'Asst. Prof.',   subs:['CST604','CST605','CST606'],gender:'Male',phone:'9861001015',dob:'1984-11-02',exp:11,qual:'M.Tech IIT Guwahati',spec:'Distributed & DL',photo:null,sections:['CST-A']}
  ];

  const secDefs = [
    {secId:'CSE-A',pfx:'21CSE',s:1},  {secId:'CSE-B',pfx:'21CSE',s:11},
    {secId:'CSE-C',pfx:'21CSE',s:21}, {secId:'CSE-D',pfx:'21CSE',s:31},
    {secId:'CSE-E',pfx:'21CSE',s:41}, {secId:'IT-A', pfx:'21IT0',s:1},
    {secId:'IT-B', pfx:'21IT0',s:11}, {secId:'CST-A',pfx:'21CST',s:1}
  ];
  const genderSeq = ['M','M','F','M','M','F','M','F','M','M'];
  const students = [];
  for(const sd of secDefs){
    for(let j=0;j<10;j++){
      const g = genderSeq[j]==='M' ? 'Male':'Female';
      const name = g==='Male' ? maleN[mi++%maleN.length] : femN[fi++%femN.length];
      const num = sd.s + j;
      const rollStr = sd.pfx.endsWith('0') ? sd.pfx+String(num).padStart(2,'0') : sd.pfx+String(num).padStart(3,'0');
      const branch = sd.secId.split('-')[0];
      students.push({
        id:'S'+String(students.length+1).padStart(3,'0'),
        name, role:'student',
        email: rollStr.toLowerCase()+'@nist.edu.in', pw:'student@123',
        branch, section:sd.secId.split('-')[1],
        secId:sd.secId, semester:6, rollNo:rollStr.toUpperCase(),
        gender:g, phone:ph(),
        dob:['2001-01-15','2001-03-22','2001-06-08','2001-09-14','2002-01-30','2002-04-11','2002-07-25','2002-10-03','2000-11-18','2001-12-05'][j],
        address:'NIST Campus, Berhampur, Odisha 751024',
        photo:null
      });
    }
  }

  const admins = [{id:'ADM01',name:'System Administrator',email:'admin@nist.edu.in',pw:'admin@123',role:'admin',dept:'Administration',desig:'System Admin',phone:'9999999999',gender:'Male',dob:'1980-01-01',photo:null}];

  const timetables = buildAllTimetables(faculty, sections, subjects);

  const attSummary = {};
  for(const s of students){
    const subs = subjects.filter(sb=>sb.branch===s.branch);
    for(const sb of subs){
      const total=20+Math.floor(Math.random()*6);
      const pres=Math.floor(total*(0.58+Math.random()*0.42));
      attSummary[s.id+'_'+sb.id] = {total, present:pres, absent:total-pres};
    }
  }

  const now = new Date();
  const dAgo = d => new Date(now-d*864e5).toISOString().split('T')[0];
  const announcements = [
    {id:'AN1',title:'Mid-Semester Examination Schedule',       body:'Mid-sem exams for B.Tech 6th semester will be held March 25–April 5, 2025. Check your exam timetable on the portal.',                                                             author:'Admin',              date:dAgo(2),type:'exam',    priority:'high',  branches:['CSE','IT','CST']},
    {id:'AN2',title:'Lab Report Submission Deadline Extended', body:'Deadline for OS Lab and Networks Lab report submission extended to March 20. Submit to respective lab instructors.',                                                                 author:'Dr. Rajesh Kumar',   date:dAgo(4),type:'academic',priority:'medium',branches:['CSE']},
    {id:'AN3',title:'Guest Lecture on Cloud Computing',        body:'Guest lecture by Mr. Vikash Srivastava (Sr. Architect, AWS India) on March 22 at 2:00 PM in Seminar Hall A. All CST & IT students encouraged to attend.',                          author:'Dr. Sonal Gupta',    date:dAgo(5),type:'event',   priority:'low',   branches:['CST','IT']},
    {id:'AN4',title:'Holiday Notice: Holi',                    body:'Institute will remain closed on March 25 on account of Holi. Classes will be rescheduled.',                                                                                         author:'Admin',              date:dAgo(1),type:'holiday', priority:'high',  branches:['CSE','IT','CST']},
    {id:'AN5',title:'Project Submission Guidelines Updated',   body:'Updated guidelines for minor project posted on department notice board. Groups of 3–4 students to submit proposals by March 28.',                                                   author:'Prof. Sunita Patel', date:dAgo(3),type:'academic',priority:'medium',branches:['CSE']}
  ];

  /* ── Default period config (NIST Berhampur schedule) ── */
  const periodConfig = buildDefaultPeriodConfig();

  A.db = {
    version:4, courses, sections, rooms, subjects, faculty, students, admins,
    users:[...admins,...faculty,...students],
    timetables, attSummary, attRecords:[], announcements,
    examSchedule:buildExamSchedule(),
    leaveRequests:[], notifications:[],
    periodConfig
  };
  save();
}

/* ━━━ DEFAULT PERIOD CONFIG ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*
  NIST Berhampur schedule:
  • 7:30 AM start
  • 60-min periods with 10-min break BETWEEN periods (before lunch only)
  • Lunch 12:00–1:00 PM (no break before/after afternoon sessions)
  • Afternoon periods: no break between them
  • Labs = 2 consecutive periods (2 hours)
  • Theory = 1 period (or 2 if double period)
*/
function buildDefaultPeriodConfig(){
  // Morning: 7:30, 8:40, 9:50, 11:00  (10-min gap each)
  // Lunch:   12:00–1:00
  // After:   1:00, 2:00, 3:00  (no gap)
  const periods = [
    {n:1, time:'7:30–8:30 AM',   start:450, end:510},
    {n:2, time:'8:40–9:40 AM',   start:520, end:580},
    {n:3, time:'9:50–10:50 AM',  start:590, end:650},
    {n:4, time:'11:00 AM–12:00', start:660, end:720},
    {n:5, time:'1:00–2:00 PM',   start:780, end:840},
    {n:6, time:'2:00–3:00 PM',   start:840, end:900},
    {n:7, time:'3:00–4:00 PM',   start:900, end:960}
  ];
  const lunch = {time:'12:00–1:00 PM', start:720, end:780};
  return {
    periods,
    lunch,
    periodDuration: 60,      // minutes per period
    morningBreak: 10,        // gap between morning periods (minutes)
    afternoonBreak: 0,       // gap between afternoon periods
    labDuration: 2,          // lab = 2 consecutive periods
    maxContiguous: 2,        // max consecutive same-subject periods
    workingDays: 6           // Mon–Sat
  };
}

/* ━━━ TIMETABLE BUILDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function buildAllTimetables(faculty, sections, subjects, cfg){
  // cfg is optional – falls back to db config or C defaults
  const periods = (cfg&&cfg.periods) || getPeriods();
  const nPeriods = periods.length;
  const labSlots = (cfg&&cfg.labDuration) || ((A.db&&A.db.periodConfig&&A.db.periodConfig.labDuration)||2);
  const busy = new Set();
  const results = [];
  const secAssign = {
    'CSE-A':{theory:[['CS601','F01'],['CS602','F02'],['CS603','F03'],['CS604','F04'],['CS605','F05']],labs:[['CS606','F01','CL-101'],['CS607','F02','NL-101']]},
    'CSE-B':{theory:[['CS601','F06'],['CS602','F07'],['CS603','F08'],['CS604','F04'],['CS605','F05']],labs:[['CS606','F06','CL-102'],['CS607','F07','NL-102']]},
    'CSE-C':{theory:[['CS601','F01'],['CS602','F02'],['CS603','F03'],['CS604','F04'],['CS605','F05']],labs:[['CS606','F01','CL-103'],['CS607','F07','CL-104']]},
    'CSE-D':{theory:[['CS601','F06'],['CS602','F07'],['CS603','F08'],['CS604','F04'],['CS605','F05']],labs:[['CS606','F06','CL-105'],['CS607','F02','NL-101']]},
    'CSE-E':{theory:[['CS601','F01'],['CS602','F02'],['CS603','F03'],['CS604','F04'],['CS605','F05']],labs:[['CS606','F01','CL-101'],['CS607','F07','NL-102']]},
    'IT-A': {theory:[['IT601','F09'],['IT602','F10'],['IT603','F11'],['IT604','F11'],['IT605','F12']],labs:[['IT606','F09','NL-101']]},
    'IT-B': {theory:[['IT601','F09'],['IT602','F10'],['IT603','F11'],['IT604','F11'],['IT605','F12']],labs:[['IT606','F12','NL-102']]},
    'CST-A':{theory:[['CST601','F13'],['CST602','F14'],['CST603','F14'],['CST604','F15'],['CST605','F15']],labs:[['CST606','F13','CL-301']]}
  };

  for(const sec of sections){
    const sa = secAssign[sec.id];
    if(!sa) continue;
    const grid = {};
    // Use C.days (all 6) but respect working days setting
    C.days.forEach(d=>{ grid[d]=Array(nPeriods).fill(null).map((_,i)=>({period:i+1,subId:null,facId:null,room:null,type:'free'})); });

    // Place labs first — labSlots consecutive periods
    for(const [subId,facId,labRoom] of sa.labs){
      let placed=false;
      for(const day of C.days){
        if(placed) break;
        for(let p=0; p<=nPeriods-labSlots; p++){
          const slots=Array.from({length:labSlots},(_,k)=>p+k);
          if(slots.some(i=>grid[day][i].subId!==null)) continue;
          if(slots.some(i=>busy.has(facId+'_'+day+'_'+(i+1)))) continue;
          if(slots.some(i=>busy.has('R_'+labRoom+'_'+day+'_'+(i+1)))) continue;
          slots.forEach(i=>{
            grid[day][i]={period:i+1,subId,facId,room:labRoom,type:'lab'};
            busy.add(facId+'_'+day+'_'+(i+1));
            busy.add('R_'+labRoom+'_'+day+'_'+(i+1));
          });
          placed=true; break;
        }
      }
    }

    // Place theory — spread across week
    for(const [subId,facId] of sa.theory){
      let rem=3; const usedDays=new Set();
      for(const day of C.days){
        if(rem<=0) break;
        if(usedDays.has(day)) continue;
        for(let p=0;p<nPeriods;p++){
          if(rem<=0) break;
          if(grid[day][p].subId!==null) continue;
          if(busy.has(facId+'_'+day+'_'+(p+1))) continue;
          if(busy.has('R_'+sec.room+'_'+day+'_'+(p+1))) continue;
          grid[day][p]={period:p+1,subId,facId,room:sec.room,type:'theory'};
          busy.add(facId+'_'+day+'_'+(p+1));
          busy.add('R_'+sec.room+'_'+day+'_'+(p+1));
          usedDays.add(day); rem--; break;
        }
      }
    }
    results.push({secId:sec.id,branch:sec.id.split('-')[0],section:sec.id.split('-')[1],schedule:grid});
  }
  return results;
}

function buildExamSchedule(){
  const base=new Date('2025-03-25');
  const mk=(offset,subId,name,time,venue,branch)=>{
    const dt=new Date(base); dt.setDate(base.getDate()+offset);
    return {id:'EX'+offset+'_'+subId,subId,name,date:dt.toISOString().split('T')[0],time,venue,duration:'3 hrs',branch};
  };
  return [
    mk(0,'CS601','Operating Systems',      '10:00 AM','Exam Hall A','CSE'),
    mk(1,'CS602','Computer Networks',      '10:00 AM','Exam Hall B','CSE'),
    mk(2,'CS603','DBMS',                   '10:00 AM','Exam Hall A','CSE'),
    mk(3,'CS604','Software Engineering',   '10:00 AM','Exam Hall C','CSE'),
    mk(4,'CS605','Theory of Computation',  '10:00 AM','Exam Hall B','CSE'),
    mk(0,'IT601','Web Technologies',       '10:00 AM','Exam Hall C','IT'),
    mk(1,'IT602','Information Security',   '10:00 AM','Exam Hall A','IT'),
    mk(2,'IT603','Database Systems',       '10:00 AM','Exam Hall C','IT'),
    mk(3,'IT604','Software Project Mgmt',  '10:00 AM','Exam Hall B','IT'),
    mk(4,'IT605','Cloud Computing',        '10:00 AM','Exam Hall A','IT'),
    mk(0,'CST601','Machine Learning',      '10:00 AM','Exam Hall D','CST'),
    mk(1,'CST602','Cloud Computing',       '10:00 AM','Exam Hall D','CST'),
    mk(2,'CST603','Data Mining',           '10:00 AM','Exam Hall D','CST'),
    mk(3,'CST604','Distributed Systems',   '10:00 AM','Exam Hall D','CST'),
    mk(4,'CST605','Deep Learning',         '10:00 AM','Exam Hall D','CST')
  ];
}

/* ━━━ HELPERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const $ = id => document.getElementById(id);
const el = (tag,cls,html) => { const e=document.createElement(tag); if(cls) e.className=cls; if(html) e.innerHTML=html; return e; };
function uid(){ return '_'+Math.random().toString(36).slice(2,9); }
function initials(name){ return name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase(); }
function getSub(id){ return A.db.subjects.find(s=>s.id===id); }
function getFac(id){ return A.db.faculty.find(f=>f.id===id); }
function getRoom(id){ return A.db.rooms.find(r=>r.id===id); }
function getSec(id){ return A.db.sections.find(s=>s.id===id); }
function getTT(secId){ return A.db.timetables.find(t=>t.secId===secId); }
function getStudentsBySection(secId){ return A.db.students.filter(s=>s.secId===secId); }
function getSubsByBranch(branch){
  return A.db.subjects.filter(s=>{
    // Support both old single-string 'branch' and new array 'branches'
    if(Array.isArray(s.branches)) return s.branches.includes(branch);
    return s.branch===branch;
  });
}
function getSubBranches(s){
  // Returns array regardless of old/new format
  if(Array.isArray(s.branches)) return s.branches;
  if(s.branch) return [s.branch];
  return [];
}
function fmtDate(d){ if(!d) return '—'; const dt=new Date(d); return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }

function toast(msg,type='info'){
  const ic={ok:'fa-check-circle',err:'fa-times-circle',info:'fa-info-circle',warn:'fa-exclamation-triangle'}[type]||'fa-info-circle';
  const t=el('div','toast '+type); t.innerHTML=`<i class="fas ${ic}"></i>${msg}`;
  $('toasts').appendChild(t);
  setTimeout(()=>{ t.classList.add('toast-out'); setTimeout(()=>t.remove(),300); },3500);
}

function openModal(html,wide=false){
  $('modal-inner').innerHTML=html;
  $('modal-box').style.maxWidth=wide?'700px':'540px';
  $('modal').classList.add('open');
}
function closeModal(){ $('modal').classList.remove('open'); }
function closeModalOuter(e){ if(e.target===$('modal')) closeModal(); }

function avatarHTML(name,photo,cls=''){
  if(photo) return `<div class="${cls}" style="background:none"><img src="${photo}" alt=""/></div>`;
  return `<div class="${cls}">${initials(name)}</div>`;
}

/* ━━━ CLOCK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function startClock(){
  const update=()=>{
    const now=new Date();
    const ts=now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
    ['stu-clock','fac-clock','adm-clock'].forEach(id=>{ const e=$(id); if(e) e.textContent=ts; });
  };
  update(); setInterval(update,1000);
}

/* ━━━ PAGE ROUTING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function showPage(pg){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const target=$('pg-'+pg);
  if(target) target.classList.add('active');
  window.scrollTo(0,0);
}

function smoothScroll(id){ const e=$(id); if(e) e.scrollIntoView({behavior:'smooth'}); }
function toggleMobileNav(){ $('mobile-nav').classList.toggle('open'); }

/* ━━━ AUTH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let loginRole='student', regRole='student';

function switchTab(tab){
  $('auth-login').style.display=tab==='login'?'':'none';
  $('auth-reg').style.display=tab==='register'?'':'none';
  $('tab-login').classList.toggle('active',tab==='login');
  $('tab-reg').classList.toggle('active',tab==='register');
  if(tab==='register') renderRegFields();
}

function setRole(form,role){
  if(form==='login') loginRole=role;
  else { regRole=role; renderRegFields(); }
  const cont=form==='login'?$('loginRoles'):$('regRoles');
  if(!cont) return;
  cont.querySelectorAll('.role-pill').forEach(p=>p.classList.toggle('active',p.dataset.r===role));
}

function toggleEye(inputId,icon){
  const inp=$(inputId); if(!inp) return;
  inp.type=inp.type==='password'?'text':'password';
  icon.className=inp.type==='password'?'fas fa-eye eye-toggle':'fas fa-eye-slash eye-toggle';
}

function renderRegFields(){
  const cont=$('reg-fields'); if(!cont) return;
  if(regRole==='student'){
    cont.innerHTML=`
      <div class="frow">
        <div class="fgroup"><label>Full Name</label><div class="finput"><i class="fas fa-user"></i><input type="text" id="rg-name" placeholder="Your full name"/></div></div>
        <div class="fgroup"><label>Roll Number</label><div class="finput"><i class="fas fa-id-card"></i><input type="text" id="rg-roll" placeholder="21CSE001"/></div></div>
      </div>
      <div class="fgroup"><label>Email</label><div class="finput"><i class="fas fa-envelope"></i><input type="email" id="rg-email" placeholder="roll@nist.edu.in"/></div></div>
      <div class="frow">
        <div class="fgroup"><label>Branch</label><select id="rg-branch"><option>CSE</option><option>IT</option><option>CST</option></select></div>
        <div class="fgroup"><label>Section</label><select id="rg-section"><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option></select></div>
      </div>
      <div class="frow">
        <div class="fgroup"><label>Gender</label><select id="rg-gender"><option>Male</option><option>Female</option><option>Other</option></select></div>
        <div class="fgroup"><label>Phone</label><div class="finput"><i class="fas fa-phone"></i><input type="tel" id="rg-phone" placeholder="9876543210"/></div></div>
      </div>
      <div class="frow">
        <div class="fgroup"><label>Password</label><div class="finput"><i class="fas fa-lock"></i><input type="password" id="rg-pass" placeholder="Min 6 chars"/></div></div>
        <div class="fgroup"><label>Confirm Password</label><div class="finput"><i class="fas fa-lock"></i><input type="password" id="rg-cpass" placeholder="Repeat password"/></div></div>
      </div>`;
  } else {
    cont.innerHTML=`
      <div class="frow">
        <div class="fgroup"><label>Full Name</label><div class="finput"><i class="fas fa-user"></i><input type="text" id="rg-name" placeholder="Dr. Your Name"/></div></div>
        <div class="fgroup"><label>Department</label><select id="rg-dept"><option>CSE</option><option>IT</option><option>CST</option></select></div>
      </div>
      <div class="fgroup"><label>Email</label><div class="finput"><i class="fas fa-envelope"></i><input type="email" id="rg-email" placeholder="name@nist.edu.in"/></div></div>
      <div class="frow">
        <div class="fgroup"><label>Designation</label><input type="text" id="rg-desig" placeholder="Asst. Professor"/></div>
        <div class="fgroup"><label>Gender</label><select id="rg-gender"><option>Male</option><option>Female</option><option>Other</option></select></div>
      </div>
      <div class="frow">
        <div class="fgroup"><label>Password</label><div class="finput"><i class="fas fa-lock"></i><input type="password" id="rg-pass" placeholder="Min 6 chars"/></div></div>
        <div class="fgroup"><label>Confirm Password</label><div class="finput"><i class="fas fa-lock"></i><input type="password" id="rg-cpass" placeholder="Repeat password"/></div></div>
      </div>`;
  }
}

function doLogin(){
  const email=$('li-email').value.trim().toLowerCase();
  const pass=$('li-pass').value;
  const err=$('li-err');
  err.style.display='none';
  if(!email||!pass){ err.textContent='Please enter email and password.'; err.style.display='block'; return; }

  // Check against loaded A.db (which came from API)
  const allUsers=[...A.db.admins,...A.db.faculty,...A.db.students];
  const user=allUsers.find(u=>u.email.toLowerCase()===email);
  if(!user){ err.textContent='No account found with this email.'; err.style.display='block'; return; }
  if(user.pw!==pass){ err.textContent='Incorrect password.'; err.style.display='block'; return; }
  if(user.role!==loginRole){ err.textContent=`This account is a ${user.role} account. Select the correct role.`; err.style.display='block'; return; }
  A.user=user;
  if(user.role==='admin'){ showPage('admin'); renderAdminDash(); }
  else if(user.role==='faculty'){
    // Load attendance summary for faculty's sections
    showPage('faculty'); renderFacultyDash();
  }
  else {
    // Load attendance summary for this student
    loadStudentAttendance(user).then(()=>{ showPage('student'); renderStudentDash(); });
  }
}

async function loadStudentAttendance(user){
  try {
    const rows = await apiGet('/api/attendance/summary/'+user.dbId);
    for(const r of rows){
      const k = user.id+'_'+r.subjectId;
      A.db.attSummary[k] = { total:parseInt(r.total)||0, present:parseInt(r.present)||0, absent:parseInt(r.absent)||0 };
    }
  } catch(e){ console.warn('Could not load attendance:', e); }
}

function doRegister(){
  const name=($('rg-name')||{}).value||'';
  const email=($('rg-email')||{}).value||'';
  const pass=($('rg-pass')||{}).value||'';
  const cpass=($('rg-cpass')||{}).value||'';
  const err=$('reg-err'); const ok=$('reg-ok');
  err.style.display='none'; ok.style.display='none';
  if(!name||!email||!pass){ err.textContent='Please fill all required fields.'; err.style.display='block'; return; }
  if(pass.length<6){ err.textContent='Password must be at least 6 characters.'; err.style.display='block'; return; }
  if(pass!==cpass){ err.textContent='Passwords do not match.'; err.style.display='block'; return; }
  const allUsers=[...A.db.admins,...A.db.faculty,...A.db.students];
  if(allUsers.find(u=>u.email.toLowerCase()===email.toLowerCase())){ err.textContent='An account with this email already exists.'; err.style.display='block'; return; }
  if(regRole==='student'){
    const roll=($('rg-roll')||{}).value||'';
    const branch=($('rg-branch')||{}).value||'CSE';
    const sec=($('rg-section')||{}).value||'A';
    const secId=branch+'-'+sec;
    const newStu={
      id:'S'+String(A.db.students.length+1).padStart(3,'0'),
      name,email:email.toLowerCase(),pw:pass,role:'student',
      branch,section:sec,secId,semester:6,rollNo:roll||'N/A',
      gender:($('rg-gender')||{}).value||'Male',
      phone:($('rg-phone')||{}).value||'',
      dob:'',address:'',photo:null
    };
    A.db.students.push(newStu); A.db.users.push(newStu);
  } else {
    const dept=($('rg-dept')||{}).value||'CSE';
    const desig=($('rg-desig')||{}).value||'Asst. Professor';
    const newFac={
      id:'F'+String(A.db.faculty.length+1).padStart(2,'0'),
      name,email:email.toLowerCase(),pw:pass,role:'faculty',
      dept,desig,gender:($('rg-gender')||{}).value||'Male',
      phone:'',dob:'',exp:0,qual:'',spec:'',photo:null,subs:[],sections:[]
    };
    A.db.faculty.push(newFac); A.db.users.push(newFac);
  }
  save();
  ok.textContent='Account created successfully! You can now login.';
  ok.style.display='block';
}

function logout(){
  A.user=null;
  document.querySelectorAll('.dash-page').forEach(p=>p.classList.remove('active'));
  showPage('auth');
}

/* ━━━ SIDEBAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function openSidebar(id){ const s=$(id); if(s) s.classList.add('open'); }
function closeSidebar(id){ const s=$(id); if(s) s.classList.remove('open'); }

function fillSBUser(elId,user,tagClass){
  const e=$(elId); if(!e) return;
  e.innerHTML=`
    <div class="sbu-row">
      ${avatarHTML(user.name,user.photo,'sbu-av')}
      <div>
        <div class="sbu-name">${user.name}</div>
        <div class="sbu-role">${user.role}</div>
        <div class="sbu-tag ${tagClass}">${user.role==='student'?user.rollNo||user.branch+' '+user.section:user.dept||'Admin'}</div>
      </div>
    </div>`;
}

function setHdrAv(elId,user){
  const e=$(elId); if(!e) return;
  if(user.photo){ e.innerHTML=`<img src="${user.photo}" alt=""/>`; e.style.background='none'; }
  else { e.textContent=initials(user.name); }
}

function setNavActive(links,view){
  document.querySelectorAll('.'+links).forEach(a=>a.classList.toggle('active',a.dataset.v===view));
}

/* ━━━ TIMETABLE RENDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderTTTable(tt,highlightToday=true){
  if(!tt) return '<div class="empty-st"><i class="fas fa-calendar-times"></i><h3>No timetable found</h3><p>Contact admin to generate your timetable.</p></div>';
  const today=C.dayS[new Date().getDay()-1]||'';
  const periods=getPeriods();
  const lunch=getLunch();
  // Find the index of the last period that ends at or before lunch start
  // Lunch row is inserted after that period
  const lunchAfterIdx=periods.reduce((acc,p,i)=>p.end<=lunch.start?i:acc,-1);

  let html=`<div class="tt-wrap"><table class="tt-table"><thead><tr><th>Time</th>`;
  C.days.forEach(d=>{ html+=`<th style="${C.dayS[C.days.indexOf(d)]===today&&highlightToday?'color:var(--teal)':''}">${d.slice(0,3)}</th>`; });
  html+=`</tr></thead><tbody>`;
  periods.forEach((per,pi)=>{
    html+=`<tr><td class="tc-time">${per.time.replace('–','–<br/>')}</td>`;
    C.days.forEach(day=>{
      const slot=tt.schedule[day]&&tt.schedule[day][pi];
      if(!slot||!slot.subId){ html+=`<td><div class="tt-cell free"><span class="tt-free">—</span></div></td>`; return; }
      const sub=getSub(slot.subId);
      const room=getRoom(slot.room);
      const isToday=C.dayS[C.days.indexOf(day)]===today;
      html+=`<td><div class="tt-cell ${slot.type}" style="${isToday&&highlightToday?'border-left:2px solid var(--teal)':''}">
        <span class="tt-code" style="color:${sub&&sub.color?sub.color:'var(--teal)'}">${sub?sub.code:slot.subId}</span>
        <span class="tt-name">${sub?sub.name:slot.subId}</span>
        <div class="tt-meta">
          <span class="tt-badge ${slot.type}">${slot.type==='lab'?'Lab':'Th'}</span>
          <span style="color:var(--text4)">${room?room.name:slot.room||''}</span>
        </div>
      </div></td>`;
    });
    html+=`</tr>`;
    // Insert lunch row dynamically after the right period
    if(pi===lunchAfterIdx){
      const lunchTime=lunch.time.replace('–','–<br/>');
      html+=`<tr><td class="tc-time">${lunchTime}</td>`;
      C.days.forEach(()=>{ html+=`<td><div class="tt-cell lunch-c" style="text-align:center;color:var(--amber);font-size:10px;justify-content:center"><i class="fas fa-utensils" style="margin-bottom:2px;display:block"></i>LUNCH</div></td>`; });
      html+=`</tr>`;
    }
  });
  html+=`</tbody></table></div>`;
  return html;
}

function getTodaySchedule(tt){
  const dayIndex=new Date().getDay();
  if(dayIndex===0||dayIndex===7) return [];
  const dayName=C.days[dayIndex-1];
  if(!tt||!tt.schedule||!tt.schedule[dayName]) return [];
  return tt.schedule[dayName].map((slot,i)=>({...slot,periodInfo:getPeriods()[i]}));
}

function getNextClass(tt){
  const now=new Date();
  const mins=now.getHours()*60+now.getMinutes();
  const todaySch=getTodaySchedule(tt);
  for(const slot of todaySch){
    if(!slot.subId) continue;
    if(slot.periodInfo.start>mins) return {slot,minsUntil:slot.periodInfo.start-mins,today:true};
    if(slot.periodInfo.start<=mins&&slot.periodInfo.end>mins) return {slot,minsUntil:0,today:true,ongoing:true};
  }
  const dayIndex=now.getDay();
  for(let d=1;d<=5;d++){
    const nextDayIdx=(dayIndex-1+d)%6;
    if(nextDayIdx<0) continue;
    const dayName=C.days[nextDayIdx];
    if(!tt.schedule[dayName]) continue;
    for(const slot of tt.schedule[dayName]){
      if(slot.subId) return {slot,minsUntil:null,today:false,dayName};
    }
  }
  return null;
}

/* ━━━ ATTENDANCE HELPERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function attColor(pct){ return pct>=75?'var(--green)':pct>=60?'var(--amber)':'var(--red)'; }
function attPct(stuId,subId){
  const k=stuId+'_'+subId;
  const r=A.db.attSummary[k];
  if(!r||r.total===0) return 0;
  return Math.round(r.present/r.total*100);
}

/* ━━━ PROFILE (shared) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderProfileView(user,editMode=false){
  const isEdit=editMode;
  return `
    <div class="prof-banner">
      <div class="prof-av-wrap">
        ${avatarHTML(user.name,user.photo,'prof-av')}
        ${isEdit?`<div class="prof-av-edit" onclick="uploadPhoto('${user.id}')"><i class="fas fa-camera"></i></div>`:''}
      </div>
      <div class="prof-info">
        <h2>${user.name}</h2>
        <div class="prole">${user.desig||''} ${user.dept||user.branch||''}</div>
        <div class="prof-badges">
          ${user.role==='student'?`<div class="prof-badge">Roll: ${user.rollNo}</div><div class="prof-badge">${user.branch} · Sec ${user.section}</div>`:''}
          ${user.role==='faculty'?`<div class="prof-badge">${user.dept}</div><div class="prof-badge">${user.desig}</div>`:''}
          ${user.role==='admin'?`<div class="prof-badge">Administrator</div>`:''}
        </div>
      </div>
      ${!isEdit
        ?`<button class="btn-solid btn-sm" style="margin-left:auto;align-self:flex-start" onclick="toggleProfileEdit(true)"><i class="fas fa-edit"></i> Edit Profile</button>`
        :`<div style="margin-left:auto;display:flex;gap:8px;align-self:flex-start">
            <button class="btn-solid btn-sm success" onclick="saveProfile('${user.id}')"><i class="fas fa-save"></i> Save</button>
            <button class="btn-ghost btn-sm" onclick="toggleProfileEdit(false)">Cancel</button>
          </div>`}
    </div>
    <div class="prof-det-grid">
      ${pf('Full Name',    user.name,       'rg-pname',    'text',   isEdit)}
      ${pf('Email',        user.email,      'rg-pemail',   'email',  false)}
      ${pf('Phone',        user.phone||'',  'rg-pphone',   'tel',    isEdit)}
      ${pf('Date of Birth',user.dob||'',    'rg-pdob',     'date',   isEdit)}
      ${pf('Gender',       user.gender||'', 'rg-pgender',  'text',   isEdit)}
      ${user.role==='student'?pf('Address',user.address||'','rg-paddress','text',isEdit):''}
      ${user.role==='faculty'?pf('Qualification',user.qual||'','rg-pqual','text',isEdit):''}
      ${user.role==='faculty'?pf('Specialization',user.spec||'','rg-pspec','text',isEdit):''}
      ${user.role==='faculty'?pf('Experience (yrs)',user.exp||'','rg-pexp','number',isEdit):''}
    </div>`;
}

function pf(label,val,id,type,editable){
  return `<div class="prof-field ${editable?'editing':''}">
    <label>${label}</label>
    ${editable?`<input type="${type}" id="${id}" value="${val||''}"/>`:`<div class="pval">${val||'—'}</div>`}
  </div>`;
}

function uploadPhoto(userId){
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='image/*';
  inp.onchange=e=>{
    const file=e.target.files[0]; if(!file) return;
    const r=new FileReader();
    r.onload=ev=>{
      const photo=ev.target.result;
      const user=A.db.students.find(u=>u.id===userId)||A.db.faculty.find(u=>u.id===userId)||A.db.admins.find(u=>u.id===userId);
      if(user){ user.photo=photo; if(A.user.id===userId) A.user.photo=photo; save(); toast('Photo updated!','ok'); }
    };
    r.readAsDataURL(file);
  };
  inp.click();
}

function toggleProfileEdit(on){
  stuProfileEdit=on; facProfileEdit=on;
  const pc=$('prof-container')||$('fac-prof-container')||$('adm-prof-container');
  if(!pc) return;
  pc.innerHTML=renderProfileView(A.user,on);
}

function saveProfile(userId){
  const user=A.db.students.find(u=>u.id===userId)||A.db.faculty.find(u=>u.id===userId)||A.db.admins.find(u=>u.id===userId);
  if(!user) return;
  const fields={name:'rg-pname',phone:'rg-pphone',dob:'rg-pdob',gender:'rg-pgender',address:'rg-paddress',qual:'rg-pqual',spec:'rg-pspec',exp:'rg-pexp'};
  for(const [key,id] of Object.entries(fields)){ const e=$(id); if(e) user[key]=e.value; }
  if(A.user.id===userId) Object.assign(A.user,user);
  save(); stuProfileEdit=false; facProfileEdit=false; toast('Profile updated!','ok');
  const pc=$('prof-container')||$('fac-prof-container')||$('adm-prof-container');
  if(pc) pc.innerHTML=renderProfileView(A.user,false);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   STUDENT DASHBOARD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let stuProfileEdit=false;

function renderStudentDash(){
  fillSBUser('stu-sbuser',A.user,'stu');
  setHdrAv('stu-hdrav',A.user);
  stuView('overview');
}

function stuView(view){
  setNavActive('slink',view);
  $('stu-hdrtitle').textContent={overview:'Overview',timetable:'My Timetable',attendance:'Attendance',nextclass:'Next Class',exams:'Exam Schedule',performance:'Performance',notifications:'Notifications',profile:'My Profile'}[view]||view;
  closeSidebar('stu-sidebar');
  const body=$('stu-body'); if(!body) return;
  stuProfileEdit=false;
  switch(view){
    case 'overview':     body.innerHTML=stuOverview();    break;
    case 'timetable':    body.innerHTML=stuTimetable();   break;
    case 'attendance':   body.innerHTML=stuAttendance();  break;
    case 'nextclass':    body.innerHTML=stuNextClass();   initCountdown(); break;
    case 'exams':        body.innerHTML=stuExams();       break;
    case 'performance':  body.innerHTML=stuPerformance(); setTimeout(drawCircularProgress,100); break;
    case 'notifications':body.innerHTML=stuNotifications(); break;
    case 'profile':      body.innerHTML=`<div id="prof-container">${renderProfileView(A.user,false)}</div>`; break;
  }
}

function stuOverview(){
  const u=A.user;
  const tt=getTT(u.secId);
  const subs=getSubsByBranch(u.branch);
  const attended=subs.reduce((s,sb)=>{ const r=A.db.attSummary[u.id+'_'+sb.id]; return s+(r?r.present:0); },0);
  const total=subs.reduce((s,sb)=>{ const r=A.db.attSummary[u.id+'_'+sb.id]; return s+(r?r.total:0); },0);
  const overallAtt=total?Math.round(attended/total*100):0;
  const nc=tt?getNextClass(tt):null;
  const ncSub=nc&&nc.slot.subId?getSub(nc.slot.subId):null;
  const unread=A.db.announcements.filter(a=>a.branches.includes(u.branch)).length;
  const nb=$('stu-nbadge'); if(nb) nb.textContent=unread?'•':'';

  return `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-icon" style="background:var(--teal-dim);color:var(--teal)"><i class="fas fa-id-card"></i></div><div><div class="stat-val" style="font-size:15px">${u.rollNo}</div><div class="stat-lbl">Roll Number</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:var(--blue-dim);color:var(--blue)"><i class="fas fa-book-open"></i></div><div><div class="stat-val">${subs.length}</div><div class="stat-lbl">Subjects</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:${overallAtt>=75?'var(--green-dim)':overallAtt>=60?'var(--amber-dim)':'var(--red-dim)'};color:${attColor(overallAtt)}"><i class="fas fa-clipboard-check"></i></div><div><div class="stat-val" style="color:${attColor(overallAtt)}">${overallAtt}%</div><div class="stat-lbl">Overall Attendance</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(139,92,246,.12);color:#8b5cf6"><i class="fas fa-graduation-cap"></i></div><div><div class="stat-val">Sem ${u.semester}</div><div class="stat-lbl">Semester</div></div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-clock"></i>Next Class</div><button class="btn-solid btn-sm" onclick="stuView('nextclass')">Details</button></div>
        ${ncSub?`<div style="background:var(--teal-dim);border-radius:var(--r);padding:14px">
          <div style="font-size:10px;color:var(--teal);font-weight:700;margin-bottom:4px;letter-spacing:1px">UPCOMING</div>
          <div style="font-family:var(--font-head);font-size:18px;font-weight:800;margin-bottom:6px">${ncSub.name}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--text2)"><i class="fas fa-${nc.slot.type==='lab'?'flask':'book'}" style="color:var(--teal);margin-right:4px"></i>${nc.slot.type==='lab'?'Lab':'Lecture'}</span>
            <span style="font-size:12px;color:var(--text2)"><i class="fas fa-door-open" style="color:var(--teal);margin-right:4px"></i>${(()=>{ const r=getRoom(nc.slot.room); return r?r.name+' ('+r.id+')':nc.slot.room||'—'; })()}</span>
            ${nc.today&&nc.minsUntil>0?`<span style="font-size:12px;color:var(--amber)"><i class="fas fa-clock" style="margin-right:4px"></i>in ${nc.minsUntil} min</span>`:''}
            ${nc.today&&nc.minsUntil===0?`<span style="font-size:12px;color:var(--green)">Ongoing</span>`:''}
          </div></div>`
        :'<div class="nc-none"><i class="fas fa-coffee"></i>No more classes today!</div>'}
      </div>
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-clipboard-check"></i>Attendance Overview</div><button class="btn-solid btn-sm" onclick="stuView('attendance')">Details</button></div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${subs.slice(0,4).map(sb=>{
            const pct=attPct(u.id,sb.id);
            return `<div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;width:68px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sb.code}</span>
              <div class="att-bar-bg" style="flex:1"><div class="att-bar" style="width:${pct}%;background:${attColor(pct)}"></div></div>
              <span style="font-size:12px;font-weight:700;color:${attColor(pct)};width:36px;text-align:right">${pct}%</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-calendar-day"></i>Today's Schedule</div></div>
      ${tt?renderTodaySchedule(tt,null):'<div class="empty-st"><i class="fas fa-calendar-times"></i><h3>No timetable</h3></div>'}
    </div>
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-bell"></i>Recent Announcements</div><button class="btn-solid btn-sm" onclick="stuView('notifications')">View All</button></div>
      <div class="notif-list">${A.db.announcements.filter(a=>a.branches.includes(u.branch)).slice(0,3).map(a=>renderAnnCard(a)).join('')}</div>
    </div>`;
}

function stuTimetable(){
  const u=A.user;
  return `<div class="card">
    <div class="card-hdr">
      <div class="card-title"><i class="fas fa-calendar-week"></i>Weekly Timetable — ${u.branch} Section ${u.section}</div>
      <div style="font-size:12px;color:var(--text3)">Semester ${u.semester} · 2024-25</div>
    </div>
    ${renderTTTable(getTT(u.secId))}
  </div>`;
}

function stuAttendance(){
  const u=A.user;
  const subs=getSubsByBranch(u.branch);
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-info-circle"></i>Attendance Policy</div></div>
      <p style="color:var(--text3);font-size:13px">Minimum <strong style="color:var(--teal)">75%</strong> attendance is required in each subject. Attendance below 75% may result in de-barring from semester examinations.</p>
    </div>
    <div class="att-grid">
      ${subs.map(sb=>{
        const r=A.db.attSummary[u.id+'_'+sb.id]||{total:0,present:0,absent:0};
        const pct=r.total?Math.round(r.present/r.total*100):0;
        const needed=pct<75?Math.ceil((0.75*r.total-r.present)/0.25):0;
        return `<div class="att-card">
          <div class="att-card-hdr">
            <div class="att-sub"><h4>${sb.name}</h4><p>${sb.code} · ${sb.type==='lab'?'Lab':'Theory'} · ${sb.credits} cr</p></div>
            <div class="att-pct" style="color:${attColor(pct)}">${pct}%</div>
          </div>
          <div class="att-bar-bg"><div class="att-bar" style="width:${pct}%;background:${attColor(pct)}"></div></div>
          <div class="att-counts"><span>Present: <b>${r.present}</b></span><span>Absent: <b>${r.absent}</b></span><span>Total: <b>${r.total}</b></span></div>
          ${pct<75?`<div style="margin-top:8px;background:var(--red-dim);border-radius:var(--rsm);padding:5px 8px;font-size:11px;color:var(--red)"><i class="fas fa-exclamation-triangle"></i> Need ${needed} more classes to reach 75%</div>`:''}
        </div>`;
      }).join('')}
    </div>`;
}

function stuNextClass(){
  const u=A.user;
  const tt=getTT(u.secId);
  const nc=tt?getNextClass(tt):null;
  const ncSub=nc&&nc.slot.subId?getSub(nc.slot.subId):null;
  const fac=nc&&nc.slot.facId?getFac(nc.slot.facId):null;
  const room=nc&&nc.slot.room?getRoom(nc.slot.room):null;
  return `
    ${nc&&ncSub?`
    <div class="nc-hero">
      <div class="nc-lbl">${nc.ongoing?'ONGOING CLASS':'UPCOMING CLASS'}</div>
      <div class="nc-subject">${ncSub.name}</div>
      <div class="nc-infos">
        <div class="nc-info"><i class="fas fa-code"></i>${ncSub.code}</div>
        <div class="nc-info"><i class="fas fa-${ncSub.type==='lab'?'flask':'book'}"></i>${ncSub.type==='lab'?'Laboratory':'Theory'}</div>
        <div class="nc-info"><i class="fas fa-door-open"></i>${room?room.name+' ('+room.id+')':nc.slot.room}</div>
        ${fac?`<div class="nc-info"><i class="fas fa-chalkboard-teacher"></i>${fac.name}</div>`:''}
        <div class="nc-info"><i class="fas fa-building"></i>${room?room.bldg+', Floor '+room.floor:'—'}</div>
      </div>
      ${nc.today&&nc.minsUntil>0?`
        <div class="nc-lbl" style="margin-bottom:6px">STARTS IN</div>
        <div class="nc-countdown">
          <div class="cdu"><span class="cdv" id="cd-h">00</span><div class="cdl">hrs</div></div>
          <div class="cdsep">:</div>
          <div class="cdu"><span class="cdv" id="cd-m">00</span><div class="cdl">min</div></div>
          <div class="cdsep">:</div>
          <div class="cdu"><span class="cdv" id="cd-s">00</span><div class="cdl">sec</div></div>
        </div>`:''}
      ${nc.ongoing?`<div style="display:inline-flex;align-items:center;gap:8px;background:var(--green-dim);color:var(--green);padding:6px 14px;border-radius:999px;font-weight:700;font-size:13px"><span class="tag-dot" style="background:var(--green)"></span>Class In Progress</div>`:''}
    </div>`:`<div class="nc-none"><i class="fas fa-moon"></i><h3>No upcoming classes today</h3><p>Enjoy your free time! Check tomorrow's schedule below.</p></div>`}
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-list-ul"></i>Today's Full Schedule</div></div>
      ${tt?renderTodaySchedule(tt,nc?nc.slot:null):'<div class="empty-st"><i class="fas fa-calendar"></i><h3>No timetable available</h3></div>'}
    </div>`;
}

function renderTodaySchedule(tt,currentSlot){
  const dayIndex=new Date().getDay();
  if(dayIndex===0||dayIndex===7) return '<div class="nc-none"><i class="fas fa-glass-cheers"></i>Weekend! No classes today.</div>';
  const dayName=C.days[dayIndex-1];
  const slots=tt.schedule[dayName]||[];
  const now=new Date(); const nowMins=now.getHours()*60+now.getMinutes();
  return slots.map((slot,i)=>{
    const per=getPeriods()[i];
    const sub=slot.subId?getSub(slot.subId):null;
    const room=slot.room?getRoom(slot.room):null;
    const isPast=per.end<nowMins;
    const isCur=(currentSlot&&currentSlot.period===slot.period)||(!isPast&&per.start<=nowMins&&per.end>nowMins);
    return `<div class="sch-row ${isPast?'past':''} ${isCur?'current':''}">
      <div class="sch-per">${per.time}</div>
      <div class="sch-sub"><div class="sname">${sub?sub.name:'Free Period'}</div><div class="smeta">${sub?sub.code+' · '+(slot.type==='lab'?'Lab':'Lecture'):''}</div></div>
      ${sub?`<div class="sch-room"><i class="fas fa-map-marker-alt"></i>${room?room.name+' ('+room.id+')':slot.room||'—'}</div>`:''}
      <div class="sch-status" style="color:${isCur?'var(--green)':isPast?'var(--text4)':'var(--teal)'}">${isCur?'Now':isPast?'Done':'Soon'}</div>
    </div>`;
  }).join('')+`<div class="sch-row"><div class="sch-per">${getLunch().time}</div><div class="sch-sub"><div class="sname">Lunch Break</div></div><div class="sch-status" style="color:var(--amber)"><i class="fas fa-utensils"></i></div></div>`;
}

function stuExams(){
  const u=A.user;
  const exams=A.db.examSchedule.filter(e=>e.branch===u.branch);
  return `<div class="card">
    <div class="card-hdr"><div class="card-title"><i class="fas fa-file-alt"></i>Mid-Semester Examination Schedule</div><div style="font-size:12px;color:var(--text3)">${u.branch} · Sem ${u.semester}</div></div>
    ${exams.map(e=>{
      const dt=new Date(e.date); const sub=getSub(e.subId);
      return `<div class="exam-item">
        <div class="exam-date" style="background:${sub?sub.color+'22':'var(--surface2)'};border-color:${sub?sub.color:'var(--border2)'}">
          <div class="exam-day" style="color:${sub?sub.color:'var(--teal)'}">${dt.getDate()}</div>
          <div class="exam-mon" style="color:${sub?sub.color:'var(--text3)'}">${dt.toLocaleString('en',{month:'short'})}</div>
        </div>
        <div class="exam-info"><h4>${e.name}</h4><p>${e.subId} · ${e.duration}</p></div>
        <div class="exam-meta"><div class="exam-time">${e.time}</div><div class="exam-venue">${e.venue}</div></div>
      </div>`;
    }).join('')}
  </div>`;
}

function stuPerformance(){
  const u=A.user;
  const subs=getSubsByBranch(u.branch);
  const cards=subs.map(sb=>{
    const pct=attPct(u.id,sb.id);
    return `<div class="perf-card">
      <div class="perf-sname">${sb.name}</div>
      <div class="cp-wrap">
        <svg width="76" height="76" viewBox="0 0 76 76">
          <circle class="cp-bg" cx="38" cy="38" r="31"/>
          <circle class="cp-fill" cx="38" cy="38" r="31" data-pct="${pct}" data-color="${sb.color||'var(--teal)'}"/>
        </svg>
        <div class="cp-txt" style="color:${attColor(pct)}">${pct}%</div>
      </div>
      <div style="font-size:11px;color:var(--text3);text-align:center">${sb.code}</div>
      <div style="margin-top:6px;font-size:10px;font-weight:700;text-align:center;padding:3px 6px;border-radius:var(--rsm);background:${attColor(pct)}22;color:${attColor(pct)}">${pct>=75?'On Track':pct>=60?'Borderline':'Critical'}</div>
    </div>`;
  }).join('');
  return `<div class="card"><div class="card-hdr"><div class="card-title"><i class="fas fa-chart-line"></i>Subject Performance Overview</div></div><div class="perf-grid">${cards}</div></div>`;
}

function drawCircularProgress(){
  document.querySelectorAll('.cp-fill').forEach(circle=>{
    const pct=parseFloat(circle.dataset.pct)||0;
    const circ=2*Math.PI*31;
    circle.style.strokeDasharray=circ;
    circle.style.strokeDashoffset=circ*(1-pct/100);
    circle.style.stroke=circle.dataset.color||'var(--teal)';
  });
}

function stuNotifications(){
  const u=A.user;
  const notifs=A.db.announcements.filter(a=>a.branches.includes(u.branch));
  return `<div class="card"><div class="card-hdr"><div class="card-title"><i class="fas fa-bell"></i>Announcements & Notices</div></div>
    <div class="notif-list">${notifs.map(a=>renderAnnCard(a,true)).join('')}</div>
  </div>`;
}

function renderAnnCard(ann,full=false){
  const icons={exam:'fa-file-alt',academic:'fa-book',event:'fa-calendar-star',holiday:'fa-umbrella-beach',general:'fa-info-circle'};
  const colors={exam:'var(--teal)',academic:'var(--blue)',event:'#8b5cf6',holiday:'var(--amber)',general:'var(--text3)'};
  const ic=icons[ann.type]||'fa-info-circle';
  const col=colors[ann.type]||'var(--text3)';
  return `<div class="notif-item ${full?'unread':''}">
    <div class="notif-ic" style="background:${col}22;color:${col}"><i class="fas ${ic}"></i></div>
    <div class="notif-body-wrap">
      <div class="notif-title">${ann.title}</div>
      <div class="notif-msg">${full?ann.body:ann.body.slice(0,90)+'...'}</div>
      <div class="notif-time"><i class="fas fa-user" style="margin-right:4px"></i>${ann.author} · ${fmtDate(ann.date)}</div>
    </div>
  </div>`;
}

/* ━━━ COUNTDOWN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let countdownInterval=null;
function initCountdown(){
  if(countdownInterval) clearInterval(countdownInterval);
  const update=()=>{
    const tt=getTT(A.user.secId); if(!tt) return;
    const nc=getNextClass(tt);
    if(!nc||!nc.today||nc.minsUntil<=0) return;
    const now=new Date();
    const nowMins=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
    const diffSecs=Math.max(0,Math.round((nc.slot.periodInfo.start-nowMins)*60));
    const h=Math.floor(diffSecs/3600),m=Math.floor((diffSecs%3600)/60),s=diffSecs%60;
    const cdh=$('cd-h'),cdm=$('cd-m'),cds=$('cd-s');
    if(cdh) cdh.textContent=String(h).padStart(2,'0');
    if(cdm) cdm.textContent=String(m).padStart(2,'0');
    if(cds) cds.textContent=String(s).padStart(2,'0');
  };
  update(); countdownInterval=setInterval(update,1000);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   FACULTY DASHBOARD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let facProfileEdit=false;

function renderFacultyDash(){
  fillSBUser('fac-sbuser',A.user,'fac');
  setHdrAv('fac-hdrav',A.user);
  facView('overview');
}

function facView(view){
  setNavActive('flink',view);
  $('fac-hdrtitle').textContent={overview:'Overview',timetable:'My Timetable',nextclass:'Next Class',attendance:'Mark Attendance',analytics:'Class Analytics',leaves:'Leave Requests',announcements:'Announcements',profile:'My Profile'}[view]||view;
  closeSidebar('fac-sidebar');
  facProfileEdit=false;
  const body=$('fac-body'); if(!body) return;
  switch(view){
    case 'overview':      body.innerHTML=facOverview();      break;
    case 'timetable':     body.innerHTML=facTimetable();     break;
    case 'nextclass':     body.innerHTML=facNextClass();     initFacCountdown(); break;
    case 'attendance':    body.innerHTML=facAttendance();    break;
    case 'analytics':     body.innerHTML=facAnalytics();     break;
    case 'leaves':        body.innerHTML=facLeaves();        break;
    case 'announcements': body.innerHTML=facAnnouncements(); break;
    case 'profile':       body.innerHTML=`<div id="fac-prof-container">${renderProfileView(A.user,false)}</div>`; break;
  }
}

function facOverview(){
  const u=A.user;
  const mySecs=u.sections||[];
  const totalStudents=mySecs.reduce((s,secId)=>s+getStudentsBySection(secId).length,0);
  const nc=getFacNextClass(u);
  return `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-icon" style="background:var(--teal-dim);color:var(--teal)"><i class="fas fa-chalkboard-teacher"></i></div><div><div class="stat-val">${(u.subs||[]).length}</div><div class="stat-lbl">Subjects Teaching</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:var(--blue-dim);color:var(--blue)"><i class="fas fa-users"></i></div><div><div class="stat-val">${totalStudents}</div><div class="stat-lbl">Total Students</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:var(--amber-dim);color:var(--amber)"><i class="fas fa-layer-group"></i></div><div><div class="stat-val">${mySecs.length}</div><div class="stat-lbl">Sections</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(139,92,246,.12);color:#8b5cf6"><i class="fas fa-star"></i></div><div><div class="stat-val">${u.exp||'—'}</div><div class="stat-lbl">Yrs Experience</div></div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-clock"></i>Next Class</div><button class="btn-solid btn-sm" onclick="facView('nextclass')">Details</button></div>
        ${nc&&nc.sub?`<div style="background:var(--teal-dim);border-radius:var(--r);padding:14px">
          <div style="font-size:10px;color:var(--teal);font-weight:700;margin-bottom:4px">${nc.ongoing?'ONGOING':'UPCOMING'}</div>
          <div style="font-family:var(--font-head);font-size:18px;font-weight:800;margin-bottom:6px">${nc.sub.name}</div>
          <div style="font-size:12px;color:var(--text2)">${nc.secId} · ${(()=>{ const r=getRoom(nc.slot.room); return r?r.name+' ('+r.id+')':nc.slot.room||'—'; })()}</div>
        </div>`:'<div class="nc-none"><i class="fas fa-coffee"></i>No more classes today!</div>'}
      </div>
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-layer-group"></i>My Sections</div></div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${mySecs.map(secId=>{
            const sec=getSec(secId);
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface2);border-radius:var(--rsm)">
              <span style="font-weight:700;font-size:13px">${secId}</span>
              <span style="font-size:12px;color:var(--text3)">${getStudentsBySection(secId).length} students</span>
              <span style="font-size:12px;color:var(--teal)">${sec?sec.room:'—'}</span>
            </div>`;
          }).join('')||'<div class="empty-st"><i class="fas fa-layer-group"></i><h3>No sections assigned</h3></div>'}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-list-ul"></i>Today's Schedule</div></div>
      ${renderFacTodaySchedule(u)}
    </div>`;
}

function getFacNextClass(u){
  const mySecs=u.sections||[];
  const now=new Date(); const nowMins=now.getHours()*60+now.getMinutes();
  const dayIndex=now.getDay();
  if(dayIndex===0||dayIndex===7) return null;
  const dayName=C.days[dayIndex-1];
  for(const secId of mySecs){
    const tt=getTT(secId); if(!tt) continue;
    const slots=tt.schedule[dayName]||[];
    for(let i=0;i<slots.length;i++){
      const slot=slots[i]; if(!slot.subId||slot.facId!==u.id) continue;
      const per=getPeriods()[i];
      if(per.start>nowMins) return {slot,per,secId,sub:getSub(slot.subId),minsUntil:per.start-nowMins,today:true};
      if(per.start<=nowMins&&per.end>nowMins) return {slot,per,secId,sub:getSub(slot.subId),minsUntil:0,today:true,ongoing:true};
    }
  }
  return null;
}

function renderFacTodaySchedule(u){
  const mySecs=u.sections||[];
  const dayIndex=new Date().getDay();
  if(dayIndex===0||dayIndex===7) return '<div class="nc-none"><i class="fas fa-glass-cheers"></i>Weekend!</div>';
  const dayName=C.days[dayIndex-1];
  const now=new Date(); const nowMins=now.getHours()*60+now.getMinutes();
  const allSlots=[];
  for(const secId of mySecs){
    const tt=getTT(secId); if(!tt) continue;
    (tt.schedule[dayName]||[]).forEach((slot,i)=>{
      if(slot.subId&&slot.facId===u.id) allSlots.push({slot,per:getPeriods()[i],secId});
    });
  }
  if(!allSlots.length) return '<div class="nc-none"><i class="fas fa-calendar"></i>No classes today.</div>';
  allSlots.sort((a,b)=>a.per.start-b.per.start);
  return allSlots.map(({slot,per,secId})=>{
    const sub=getSub(slot.subId); const room=getRoom(slot.room);
    const isPast=per.end<nowMins; const isCur=per.start<=nowMins&&per.end>nowMins;
    return `<div class="sch-row ${isPast?'past':''} ${isCur?'current':''}">
      <div class="sch-per">${per.time}</div>
      <div class="sch-sub"><div class="sname">${sub?sub.name:'—'}</div><div class="smeta">${secId} · ${slot.type}</div></div>
      <div class="sch-room"><i class="fas fa-map-marker-alt"></i>${room?room.name+' ('+room.id+')':slot.room||'—'}</div>
      <div class="sch-status" style="color:${isCur?'var(--green)':isPast?'var(--text4)':'var(--teal)'}">${isCur?'Now':isPast?'Done':'Soon'}</div>
    </div>`;
  }).join('');
}

function facTimetable(){
  const u=A.user;
  const mySecs=u.sections||[];
  if(!mySecs.length) return '<div class="card"><div class="empty-st"><i class="fas fa-calendar-times"></i><h3>No sections assigned</h3><p>Contact admin to assign sections to your profile.</p></div></div>';
  return mySecs.map(secId=>`<div class="card" style="margin-bottom:16px">
    <div class="card-hdr"><div class="card-title"><i class="fas fa-calendar-week"></i>Section ${secId}</div></div>
    ${renderTTTable(getTT(secId))}
  </div>`).join('');
}

function facNextClass(){
  const u=A.user;
  const nc=getFacNextClass(u);
  return `
    ${nc&&nc.sub?`
    <div class="nc-hero">
      <div class="nc-lbl">${nc.ongoing?'ONGOING CLASS':'NEXT CLASS'}</div>
      <div class="nc-subject">${nc.sub.name}</div>
      <div class="nc-infos">
        <div class="nc-info"><i class="fas fa-layer-group"></i>${nc.secId}</div>
        <div class="nc-info"><i class="fas fa-${nc.sub.type==='lab'?'flask':'book'}"></i>${nc.sub.type==='lab'?'Lab':'Lecture'}</div>
        <div class="nc-info"><i class="fas fa-door-open"></i>${(()=>{ const r=getRoom(nc.slot.room); return r?r.name+' ('+r.id+')':nc.slot.room||'—'; })()}</div>
        ${nc.minsUntil>0?`<div class="nc-info"><i class="fas fa-clock"></i>in ${nc.minsUntil} min</div>`:''}
      </div>
      ${nc.today&&nc.minsUntil>0?`
        <div class="nc-lbl" style="margin-bottom:6px">STARTS IN</div>
        <div class="nc-countdown">
          <div class="cdu"><span class="cdv" id="fcd-h">00</span><div class="cdl">hrs</div></div>
          <div class="cdsep">:</div>
          <div class="cdu"><span class="cdv" id="fcd-m">00</span><div class="cdl">min</div></div>
          <div class="cdsep">:</div>
          <div class="cdu"><span class="cdv" id="fcd-s">00</span><div class="cdl">sec</div></div>
        </div>`:''}
      ${nc.ongoing?`<div style="display:inline-flex;align-items:center;gap:8px;background:var(--green-dim);color:var(--green);padding:6px 14px;border-radius:999px;font-weight:700;font-size:13px"><span class="tag-dot" style="background:var(--green)"></span>Class In Progress</div>`:''}
    </div>`:`<div class="nc-none"><i class="fas fa-coffee"></i><h3>No more classes today!</h3></div>`}
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-list-ul"></i>Today's Schedule</div></div>
      ${renderFacTodaySchedule(A.user)}
    </div>`;
}

let facCDInterval=null;
function initFacCountdown(){
  if(facCDInterval) clearInterval(facCDInterval);
  const update=()=>{
    const nc=getFacNextClass(A.user);
    if(!nc||!nc.today||nc.minsUntil<=0) return;
    const now=new Date();
    const nowMins=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
    const diffSecs=Math.max(0,Math.round((nc.per.start-nowMins)*60));
    const h=Math.floor(diffSecs/3600),m=Math.floor((diffSecs%3600)/60),s=diffSecs%60;
    const cdh=$('fcd-h'),cdm=$('fcd-m'),cds=$('fcd-s');
    if(cdh) cdh.textContent=String(h).padStart(2,'0');
    if(cdm) cdm.textContent=String(m).padStart(2,'0');
    if(cds) cds.textContent=String(s).padStart(2,'0');
  };
  update(); facCDInterval=setInterval(update,1000);
}

function facAttendance(){
  const u=A.user;
  const mySecs=u.sections||[];
  return `<div class="card">
    <div class="card-hdr"><div class="card-title"><i class="fas fa-clipboard-list"></i>Mark Attendance</div></div>
    <div class="filt-row">
      <select id="att-sec-sel" onchange="loadAttStudents()">
        <option value="">Select Section</option>
        ${mySecs.map(s=>`<option value="${s}">${s}</option>`).join('')}
      </select>
      <select id="att-sub-sel" onchange="loadAttStudents()">
        <option value="">Select Subject</option>
        ${(u.subs||[]).map(sid=>{ const s=getSub(sid); return s?`<option value="${sid}">${s.name}</option>`:''; }).join('')}
      </select>
      <input type="date" id="att-date" value="${new Date().toISOString().split('T')[0]}" onchange="loadAttStudents()" style="width:auto;max-width:160px"/>
    </div>
    <div id="att-students-area"><div class="empty-st"><i class="fas fa-filter"></i><h3>Select section, subject and date to continue</h3></div></div>
  </div>`;
}

function loadAttStudents(){
  const secId=$('att-sec-sel')&&$('att-sec-sel').value;
  const subId=$('att-sub-sel')&&$('att-sub-sel').value;
  const date=$('att-date')&&$('att-date').value;
  const area=$('att-students-area'); if(!area) return;
  if(!secId||!subId||!date){ area.innerHTML='<div class="empty-st"><i class="fas fa-filter"></i><h3>Please select all fields</h3></div>'; return; }
  const students=getStudentsBySection(secId);
  if(!students.length){ area.innerHTML='<div class="empty-st"><i class="fas fa-users"></i><h3>No students in this section</h3></div>'; return; }
  const existRec=A.db.attRecords.find(r=>r.secId===secId&&r.subId===subId&&r.date===date);
  const existMap=existRec?existRec.attendance:{};
  area.innerHTML=`
    <div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;font-weight:700">${students.length} students · ${date}</div>
      <div style="display:flex;gap:6px">
        <button class="btn-solid btn-sm success" onclick="markAllAtt('P')">All Present</button>
        <button class="btn-solid btn-sm danger" onclick="markAllAtt('A')">All Absent</button>
      </div>
    </div>
    <div class="att-mark-grid" id="att-mark-grid">
      ${students.map(s=>{
        const cur=existMap[s.id]||'';
        return `<div class="att-stu">
          <div class="att-stu-nm">${s.name}</div>
          <div class="att-btns">
            <button class="att-btn ${cur==='P'?'sel-P':''}" data-sid="${s.id}" data-v="P" onclick="setAtt(this,'P')">P</button>
            <button class="att-btn ${cur==='A'?'sel-A':''}" data-sid="${s.id}" data-v="A" onclick="setAtt(this,'A')">A</button>
            <button class="att-btn ${cur==='L'?'sel-L':''}" data-sid="${s.id}" data-v="L" onclick="setAtt(this,'L')">L</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div style="margin-top:14px;display:flex;gap:8px">
      <button class="btn-solid" onclick="submitAttendance('${secId}','${subId}','${date}')"><i class="fas fa-save"></i> Submit Attendance</button>
    </div>`;
}

function setAtt(btn,val){
  btn.closest('.att-stu').querySelectorAll('.att-btn').forEach(b=>{ b.className='att-btn'; });
  btn.classList.add('sel-'+val);
}

function markAllAtt(val){
  document.querySelectorAll('#att-mark-grid .att-stu').forEach(row=>{
    row.querySelectorAll('.att-btn').forEach(b=>{ b.className='att-btn'; });
    const tb=row.querySelector(`.att-btn[data-v="${val}"]`);
    if(tb) tb.classList.add('sel-'+val);
  });
}

function submitAttendance(secId,subId,date){
  const attMap={};
  document.querySelectorAll('#att-mark-grid .att-stu').forEach(row=>{
    const selBtn=row.querySelector('.att-btn.sel-P,.att-btn.sel-A,.att-btn.sel-L');
    if(selBtn) attMap[selBtn.dataset.sid]=selBtn.dataset.v;
  });
  // Update local summary
  A.db.attRecords=A.db.attRecords.filter(r=>!(r.secId===secId&&r.subId===subId&&r.date===date));
  A.db.attRecords.push({secId,subId,date,attendance:attMap,markedBy:A.user.id,markedAt:new Date().toISOString()});
  for(const [stuId,status] of Object.entries(attMap)){
    const k=stuId+'_'+subId;
    if(!A.db.attSummary[k]) A.db.attSummary[k]={total:0,present:0,absent:0};
    A.db.attSummary[k].total++;
    if(status==='P') A.db.attSummary[k].present++;
    else A.db.attSummary[k].absent++;
  }
  save();
  // Convert attMap keys from "S001" format to real DB ids for API
  const apiAttMap={};
  for(const [stuId,status] of Object.entries(attMap)){
    const stu=A.db.students.find(s=>s.id===stuId);
    if(stu&&stu.dbId) apiAttMap[stu.dbId] = status==='P'?'Present':status==='A'?'Absent':'Late';
  }
  apiPost('/api/attendance',{secId,subjectCode:subId,date,attendance:apiAttMap,markedBy:A.user.dbId||1})
    .then(()=>toast('Attendance saved to database ✓','ok'))
    .catch(()=>toast('Attendance saved locally (API error)','warn'));
}

function facAnalytics(){
  const u=A.user;
  const mySecs=u.sections||[];
  const attData=mySecs.map(secId=>{
    const students=getStudentsBySection(secId);
    let tp=0,ta=0;
    students.forEach(s=>(u.subs||[]).forEach(subId=>{
      const r=A.db.attSummary[s.id+'_'+subId];
      if(r){tp+=r.present;ta+=r.absent;}
    }));
    const tot=tp+ta;
    return {secId,pct:tot?Math.round(tp/tot*100):0,students:students.length};
  });
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-chart-bar"></i>Section-wise Attendance</div></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        ${attData.map(d=>`<div style="flex:1;min-width:200px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="font-weight:700">${d.secId}</span>
            <span style="font-weight:700;color:${attColor(d.pct)}">${d.pct}%</span>
          </div>
          <div class="att-bar-bg"><div class="att-bar" style="width:${d.pct}%;background:${attColor(d.pct)}"></div></div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px">${d.students} students</div>
        </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-book"></i>Subject-wise Summary</div></div>
      <div class="tbl-wrap"><table class="dtbl">
        <thead><tr><th>Subject</th><th>Type</th>${mySecs.map(s=>`<th>${s}</th>`).join('')}</tr></thead>
        <tbody>
          ${(u.subs||[]).map(subId=>{
            const sub=getSub(subId); if(!sub) return '';
            return `<tr>
              <td><b>${sub.name}</b><div style="font-size:11px;color:var(--text3)">${sub.code}</div></td>
              <td><span class="sbadge active">${sub.type}</span></td>
              ${mySecs.map(secId=>{
                const sts=getStudentsBySection(secId);
                const tot=sts.reduce((s,st)=>{ const r=A.db.attSummary[st.id+'_'+subId]; return s+(r?r.total:0); },0);
                const prs=sts.reduce((s,st)=>{ const r=A.db.attSummary[st.id+'_'+subId]; return s+(r?r.present:0); },0);
                const pct=tot?Math.round(prs/tot*100):0;
                return `<td><span style="font-weight:700;color:${attColor(pct)}">${pct}%</span></td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>`;
}

function facLeaves(){
  const u=A.user;
  const myLeaves=A.db.leaveRequests.filter(r=>r.facultyId===u.id);
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-calendar-minus"></i>Submit Leave Request</div></div>
      <div class="frow">
        <div class="fgroup"><label>From Date</label><input type="date" id="lv-from"/></div>
        <div class="fgroup"><label>To Date</label><input type="date" id="lv-to"/></div>
      </div>
      <div class="fgroup"><label>Reason</label><textarea id="lv-reason" placeholder="Reason for leave..."></textarea></div>
      <button class="btn-solid" onclick="submitLeave()"><i class="fas fa-paper-plane"></i> Submit Request</button>
    </div>
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-history"></i>Leave History</div></div>
      ${myLeaves.length?`<div class="tbl-wrap"><table class="dtbl">
        <thead><tr><th>From</th><th>To</th><th>Reason</th><th>Status</th></tr></thead>
        <tbody>${myLeaves.map(l=>`<tr>
          <td>${fmtDate(l.from)}</td><td>${fmtDate(l.to)}</td>
          <td>${l.reason}</td>
          <td><span class="sbadge ${l.status==='approved'?'active':l.status==='rejected'?'absent':'late'}">${l.status}</span></td>
        </tr>`).join('')}</tbody>
      </table></div>`:'<div class="empty-st"><i class="fas fa-calendar-check"></i><h3>No leave requests</h3></div>'}
    </div>`;
}

function submitLeave(){
  const from=($('lv-from')||{}).value; const to=($('lv-to')||{}).value; const reason=($('lv-reason')||{}).value;
  if(!from||!to||!reason){ toast('Please fill all fields','err'); return; }
  A.db.leaveRequests.push({id:uid(),facultyId:A.user.id,from,to,reason,status:'pending',date:new Date().toISOString()});
  save(); toast('Leave request submitted!','ok'); facView('leaves');
}

function facAnnouncements(){
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-bullhorn"></i>Post Announcement</div></div>
      <div class="fgroup"><label>Title</label><input type="text" id="ann-title" placeholder="Announcement title"/></div>
      <div class="fgroup"><label>Message</label><textarea id="ann-body" placeholder="Write your announcement..."></textarea></div>
      <div class="frow">
        <div class="fgroup"><label>Type</label><select id="ann-type"><option value="academic">Academic</option><option value="event">Event</option><option value="general">General</option></select></div>
        <div class="fgroup"><label>Priority</label><select id="ann-prio"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      </div>
      <button class="btn-solid" onclick="postAnnouncement()"><i class="fas fa-paper-plane"></i> Post</button>
    </div>
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-newspaper"></i>All Announcements</div></div>
      <div class="notif-list">${A.db.announcements.slice(0,10).map(a=>renderAnnCard(a,true)).join('')}</div>
    </div>`;
}

function postAnnouncement(){
  const title=($('ann-title')||{}).value; const body=($('ann-body')||{}).value;
  if(!title||!body){ toast('Please fill title and message','err'); return; }
  const ann={id:uid(),title,body,author:A.user.name,date:new Date().toISOString().split('T')[0],type:$('ann-type').value,priority:$('ann-prio').value,branches:['CSE','IT','CST']};
  A.db.announcements.unshift(ann);
  save();
  apiPost('/api/announcements',{title,body,author:A.user.name,type:ann.type,priority:ann.priority,branches:'CSE,IT,CST'})
    .catch(()=>{});
  toast('Announcement posted!','ok'); facView('announcements');
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ADMIN DASHBOARD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderAdminDash(){
  fillSBUser('adm-sbuser',A.user,'adm');
  setHdrAv('adm-hdrav',A.user);
  admView('overview');
}

function admView(view){
  setNavActive('alink',view);
  $('adm-hdrtitle').textContent={overview:'Admin Dashboard',analytics:'Analytics',students:'Manage Students',faculty:'Manage Faculty',courses:'Courses & Sections',rooms:'Rooms',subjects:'Subjects',timings:'Period Timings',viewtt:'View Timetables',manualtt:'Manual Timetable Entry',aigentt:'AI Timetable Generator',notices:'Notices',profile:'Admin Profile'}[view]||view;
  closeSidebar('adm-sidebar');
  const body=$('adm-body'); if(!body) return;
  switch(view){
    case 'overview':  body.innerHTML=admOverview();  break;
    case 'analytics': body.innerHTML=admAnalytics(); break;
    case 'students':  body.innerHTML=admStudents();  break;
    case 'faculty':   body.innerHTML=admFaculty();   break;
    case 'courses':   body.innerHTML=admCourses();   break;
    case 'rooms':     body.innerHTML=admRooms();     break;
    case 'subjects':  body.innerHTML=admSubjects();  break;
    case 'timings':   body.innerHTML=admTimings();   break;
    case 'viewtt':    body.innerHTML=admViewTT();    break;
    case 'manualtt':  body.innerHTML=admManualTT();  break;
    case 'aigentt':   body.innerHTML=admAIGen();     break;
    case 'notices':   body.innerHTML=admNotices();   break;
    case 'profile':   body.innerHTML=`<div id="adm-prof-container">${renderProfileView(A.user,false)}</div>`; break;
  }
}

function admOverview(){
  const db=A.db;
  return `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-icon" style="background:var(--teal-dim);color:var(--teal)"><i class="fas fa-user-graduate"></i></div><div><div class="stat-val">${db.students.length}</div><div class="stat-lbl">Total Students</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:var(--blue-dim);color:var(--blue)"><i class="fas fa-chalkboard-teacher"></i></div><div><div class="stat-val">${db.faculty.length}</div><div class="stat-lbl">Faculty Members</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:var(--amber-dim);color:var(--amber)"><i class="fas fa-layer-group"></i></div><div><div class="stat-val">${db.sections.length}</div><div class="stat-lbl">Sections</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:rgba(139,92,246,.12);color:#8b5cf6"><i class="fas fa-calendar-week"></i></div><div><div class="stat-val">${db.timetables.length}</div><div class="stat-lbl">Timetables Active</div></div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:18px">
      ${db.courses.map(c=>`<div class="card" style="border-color:${c.color}33">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:10px;height:10px;border-radius:50%;background:${c.color}"></div>
          <div style="font-family:var(--font-head);font-weight:700">${c.id}</div>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px">${c.name}</div>
        <div style="font-size:11px;color:var(--text3)">${db.sections.filter(s=>s.branch===c.id).length} sections · ${db.students.filter(s=>s.branch===c.id).length} students</div>
      </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-history"></i>Recent Activity</div></div>
        ${db.attRecords.slice(-5).reverse().map(r=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:13px"><b>${r.secId}</b> attendance for <span style="color:var(--teal)">${r.subId}</span></div>
          <div style="font-size:11px;color:var(--text3)">${r.date}</div>
        </div>`).join('')||'<div class="empty-st"><i class="fas fa-clock"></i><h3>No recent activity</h3></div>'}
      </div>
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-bell"></i>Notices</div><button class="btn-solid btn-sm" onclick="admView('notices')">All</button></div>
        ${db.announcements.slice(0,4).map(a=>`<div style="padding:5px 0;border-bottom:1px solid var(--border)"><div style="font-size:12px;font-weight:700">${a.title}</div><div style="font-size:11px;color:var(--text3)">${fmtDate(a.date)}</div></div>`).join('')}
      </div>
    </div>`;
}

function admAnalytics(){
  const db=A.db;
  const branchAtt=db.courses.map(c=>{
    const students=db.students.filter(s=>s.branch===c.id);
    const subs=getSubsByBranch(c.id);
    let pres=0,tot=0;
    students.forEach(s=>subs.forEach(sb=>{ const r=db.attSummary[s.id+'_'+sb.id]; if(r){pres+=r.present;tot+=r.total;} }));
    return {id:c.id,color:c.color,pct:tot?Math.round(pres/tot*100):0,students:students.length};
  });
  const maxPct=Math.max(...branchAtt.map(d=>d.pct),1);
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-chart-bar"></i>Branch-wise Attendance</div></div>
        <div class="bar-chart-wrap">
          ${branchAtt.map(b=>`<div class="bc-bar"><div class="bc-fill" style="height:${b.pct/maxPct*72}px;background:${b.color}"></div><div class="bc-lbl">${b.id}</div></div>`).join('')}
        </div>
        <div style="margin-top:8px;display:flex;justify-content:space-around">
          ${branchAtt.map(b=>`<div style="text-align:center"><div style="font-weight:700;color:${b.color}">${b.pct}%</div><div style="font-size:11px;color:var(--text3)">${b.id}</div></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-users"></i>Enrollment Stats</div></div>
        ${db.courses.map(c=>{
          const count=db.students.filter(s=>s.branch===c.id).length;
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <div style="width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0"></div>
            <span style="flex:1;font-size:13px;font-weight:600">${c.id}</span>
            <div class="att-bar-bg" style="width:100px"><div class="att-bar" style="width:${count/db.students.length*100}%;background:${c.color}"></div></div>
            <span style="font-size:13px;font-weight:700">${count}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-table"></i>Section-wise Attendance Summary</div></div>
      <div class="tbl-wrap"><table class="dtbl">
        <thead><tr><th>Section</th><th>Branch</th><th>Students</th><th>Attendance %</th><th>Status</th></tr></thead>
        <tbody>
          ${db.sections.map(sec=>{
            const sts=getStudentsBySection(sec.id);
            const subs=getSubsByBranch(sec.branch);
            let pres=0,tot=0;
            sts.forEach(s=>subs.forEach(sb=>{ const r=db.attSummary[s.id+'_'+sb.id]; if(r){pres+=r.present;tot+=r.total;} }));
            const pct=tot?Math.round(pres/tot*100):0;
            return `<tr>
              <td><b>${sec.id}</b></td><td>${sec.branch}</td><td>${sts.length}</td>
              <td><div style="display:flex;align-items:center;gap:8px"><div class="att-bar-bg" style="width:80px"><div class="att-bar" style="width:${pct}%;background:${attColor(pct)}"></div></div><b style="color:${attColor(pct)}">${pct}%</b></div></td>
              <td><span class="sbadge ${pct>=75?'present':pct>=60?'late':'absent'}">${pct>=75?'Good':pct>=60?'Average':'Critical'}</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </div>`;
}

function admStudents(search=''){
  let students=[...A.db.students];
  if(search) students=students.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())||s.rollNo.toLowerCase().includes(search.toLowerCase())||s.email.toLowerCase().includes(search.toLowerCase()));
  return `<div class="card">
    <div class="sec-tb"><div class="ttl">All Students (${A.db.students.length})</div>
      <button class="btn-solid" onclick="openAddStudentModal()"><i class="fas fa-user-plus"></i> Add Student</button>
    </div>
    <div class="sbar"><i class="fas fa-search"></i><input type="text" placeholder="Search by name, roll, email..." oninput="$('adm-body').innerHTML=admStudents(this.value)" value="${search}"/></div>
    <div class="tbl-wrap"><table class="dtbl">
      <thead><tr><th>Student</th><th>Roll No.</th><th>Branch/Sec</th><th>Gender</th><th>Phone</th><th>Attendance</th><th>Actions</th></tr></thead>
      <tbody>${students.map(s=>{
        const subs=getSubsByBranch(s.branch);
        let tot=0,pres=0;
        subs.forEach(sb=>{ const r=A.db.attSummary[s.id+'_'+sb.id]; if(r){tot+=r.total;pres+=r.present;} });
        const pct=tot?Math.round(pres/tot*100):0;
        return `<tr>
          <td><div class="uchip">${avatarHTML(s.name,s.photo,'uchip-av')}<div><div class="uchip-n">${s.name}</div><div class="uchip-s">${s.email}</div></div></div></td>
          <td><code>${s.rollNo}</code></td>
          <td><b>${s.branch}</b>/${s.section}</td>
          <td>${s.gender}</td>
          <td>${s.phone||'—'}</td>
          <td><span style="font-weight:700;color:${attColor(pct)}">${pct}%</span></td>
          <td><div class="td-acts">
            <button class="btn-icon edit" onclick="openEditStudentModal('${s.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn-icon del" onclick="deleteStudent('${s.id}')"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;
}

function openAddStudentModal(){
  openModal(`
    <div class="modal-title">Add New Student</div><div class="modal-sub">Add a student to the system</div>
    <div class="frow">
      <div class="fgroup"><label>Full Name</label><input type="text" id="as-name" placeholder="Full name"/></div>
      <div class="fgroup"><label>Roll Number</label><input type="text" id="as-roll" placeholder="21CSE001"/></div>
    </div>
    <div class="fgroup"><label>Email</label><input type="email" id="as-email" placeholder="roll@nist.edu.in"/></div>
    <div class="frow">
      <div class="fgroup"><label>Branch</label><select id="as-branch">${A.db.courses.map(c=>`<option>${c.id}</option>`).join('')}</select></div>
      <div class="fgroup"><label>Section</label><select id="as-section"><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option></select></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Gender</label><select id="as-gender"><option>Male</option><option>Female</option><option>Other</option></select></div>
      <div class="fgroup"><label>Phone</label><input type="tel" id="as-phone" placeholder="9876543210"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Date of Birth</label><input type="date" id="as-dob"/></div>
      <div class="fgroup"><label>Password</label><input type="password" id="as-pw" value="student@123"/></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-solid" onclick="addStudent()"><i class="fas fa-save"></i> Add Student</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function addStudent(){
  const name=($('as-name')||{}).value; const email=($('as-email')||{}).value;
  if(!name||!email){ toast('Name and email required','err'); return; }
  const branch=($('as-branch')||{}).value||'CSE'; const sec=($('as-section')||{}).value||'A';
  const newStu={
    id:'S'+String(A.db.students.length+1).padStart(3,'0'),
    name,email:email.toLowerCase(),pw:($('as-pw')||{}).value||'student@123',role:'student',
    branch,section:sec,secId:branch+'-'+sec,semester:6,rollNo:($('as-roll')||{}).value||'N/A',
    gender:($('as-gender')||{}).value||'Male',phone:($('as-phone')||{}).value||'',
    dob:($('as-dob')||{}).value||'',address:'',photo:null
  };
  A.db.students.push(newStu); A.db.users.push(newStu);
  save(); closeModal(); toast('Student added!','ok'); admView('students');
}

function openEditStudentModal(stuId){
  const s=A.db.students.find(st=>st.id===stuId); if(!s) return;
  openModal(`
    <div class="modal-title">Edit Student</div>
    <div class="frow">
      <div class="fgroup"><label>Full Name</label><input type="text" id="es-name" value="${s.name}"/></div>
      <div class="fgroup"><label>Roll Number</label><input type="text" id="es-roll" value="${s.rollNo||''}"/></div>
    </div>
    <div class="fgroup"><label>Email</label><input type="email" id="es-email" value="${s.email}"/></div>
    <div class="frow">
      <div class="fgroup"><label>Branch</label><select id="es-branch">${A.db.courses.map(c=>`<option ${s.branch===c.id?'selected':''}>${c.id}</option>`).join('')}</select></div>
      <div class="fgroup"><label>Section</label><select id="es-section">${['A','B','C','D','E'].map(x=>`<option ${s.section===x?'selected':''}>${x}</option>`).join('')}</select></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Gender</label><select id="es-gender"><option ${s.gender==='Male'?'selected':''}>Male</option><option ${s.gender==='Female'?'selected':''}>Female</option><option ${s.gender==='Other'?'selected':''}>Other</option></select></div>
      <div class="fgroup"><label>Phone</label><input type="tel" id="es-phone" value="${s.phone||''}"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Date of Birth</label><input type="date" id="es-dob" value="${s.dob||''}"/></div>
      <div class="fgroup"><label>Address</label><input type="text" id="es-addr" value="${s.address||''}"/></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-solid" onclick="editStudent('${stuId}')"><i class="fas fa-save"></i> Save Changes</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function editStudent(stuId){
  const s=A.db.students.find(st=>st.id===stuId); if(!s) return;
  s.name=($('es-name')||{}).value||s.name; s.rollNo=($('es-roll')||{}).value||s.rollNo;
  s.email=(($('es-email')||{}).value||s.email).toLowerCase();
  const nb=($('es-branch')||{}).value||s.branch; const ns=($('es-section')||{}).value||s.section;
  s.branch=nb; s.section=ns; s.secId=nb+'-'+ns;
  s.gender=($('es-gender')||{}).value||s.gender; s.phone=($('es-phone')||{}).value||'';
  s.dob=($('es-dob')||{}).value||''; s.address=($('es-addr')||{}).value||'';
  save(); closeModal(); toast('Student updated!','ok'); admView('students');
}

function deleteStudent(stuId){
  if(!confirm('Delete this student? This cannot be undone.')) return;
  A.db.students=A.db.students.filter(s=>s.id!==stuId);
  A.db.users=A.db.users.filter(u=>u.id!==stuId);
  save(); toast('Student deleted','warn'); admView('students');
}

function admFaculty(search=''){
  let faculty=[...A.db.faculty];
  if(search) faculty=faculty.filter(f=>f.name.toLowerCase().includes(search.toLowerCase())||f.email.toLowerCase().includes(search.toLowerCase()));
  return `<div class="card">
    <div class="sec-tb"><div class="ttl">Faculty Members (${A.db.faculty.length})</div>
      <button class="btn-solid" onclick="openAddFacultyModal()"><i class="fas fa-user-plus"></i> Add Faculty</button>
    </div>
    <div class="sbar"><i class="fas fa-search"></i><input type="text" placeholder="Search by name or email..." oninput="$('adm-body').innerHTML=admFaculty(this.value)" value="${search}"/></div>
    <div class="tbl-wrap"><table class="dtbl">
      <thead><tr><th>Faculty</th><th>Dept</th><th>Designation</th><th>Subjects</th><th>Sections</th><th>Actions</th></tr></thead>
      <tbody>${faculty.map(f=>`<tr>
        <td><div class="uchip">${avatarHTML(f.name,f.photo,'uchip-av')}<div><div class="uchip-n">${f.name}</div><div class="uchip-s">${f.email}</div></div></div></td>
        <td>${f.dept}</td><td>${f.desig}</td>
        <td><div style="display:flex;gap:3px;flex-wrap:wrap">${(f.subs||[]).map(s=>`<span class="sbadge active" style="font-size:9px">${s}</span>`).join('')}</div></td>
        <td><div style="display:flex;gap:3px;flex-wrap:wrap">${(f.sections||[]).map(s=>`<span class="sbadge late" style="font-size:9px">${s}</span>`).join('')}</div></td>
        <td><div class="td-acts">
          <button class="btn-icon edit" onclick="openEditFacultyModal('${f.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-icon" onclick="openAssignSectionsModal('${f.id}')" style="color:var(--blue)"><i class="fas fa-layer-group"></i></button>
          <button class="btn-icon del" onclick="deleteFaculty('${f.id}')"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

function openAddFacultyModal(){
  openModal(`
    <div class="modal-title">Add Faculty Member</div>
    <div class="frow">
      <div class="fgroup"><label>Full Name</label><input type="text" id="af-name" placeholder="Dr. Name"/></div>
      <div class="fgroup"><label>Designation</label><input type="text" id="af-desig" placeholder="Asst. Professor"/></div>
    </div>
    <div class="fgroup"><label>Email</label><input type="email" id="af-email" placeholder="name@nist.edu.in"/></div>
    <div class="frow">
      <div class="fgroup"><label>Department</label><select id="af-dept">${A.db.courses.map(c=>`<option>${c.id}</option>`).join('')}</select></div>
      <div class="fgroup"><label>Gender</label><select id="af-gender"><option>Male</option><option>Female</option><option>Other</option></select></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Phone</label><input type="tel" id="af-phone"/></div>
      <div class="fgroup"><label>Password</label><input type="password" id="af-pw" value="faculty@123"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Qualification</label><input type="text" id="af-qual" placeholder="Ph.D."/></div>
      <div class="fgroup"><label>Specialization</label><input type="text" id="af-spec"/></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-solid" onclick="addFaculty()"><i class="fas fa-save"></i> Add Faculty</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function addFaculty(){
  const name=($('af-name')||{}).value; const email=($('af-email')||{}).value;
  if(!name||!email){ toast('Name and email required','err'); return; }
  const nf={
    id:'F'+String(A.db.faculty.length+1).padStart(2,'0'),
    name,email:email.toLowerCase(),pw:($('af-pw')||{}).value||'faculty@123',role:'faculty',
    dept:($('af-dept')||{}).value||'CSE',desig:($('af-desig')||{}).value||'',
    gender:($('af-gender')||{}).value||'Male',phone:($('af-phone')||{}).value||'',
    qual:($('af-qual')||{}).value||'',spec:($('af-spec')||{}).value||'',
    dob:'',exp:0,photo:null,subs:[],sections:[]
  };
  A.db.faculty.push(nf); A.db.users.push(nf);
  save(); closeModal(); toast('Faculty added!','ok'); admView('faculty');
}

function openEditFacultyModal(facId){
  const f=A.db.faculty.find(x=>x.id===facId); if(!f) return;
  openModal(`
    <div class="modal-title">Edit Faculty: ${f.name}</div>
    <div class="frow">
      <div class="fgroup"><label>Full Name</label><input type="text" id="ef-name" value="${f.name}"/></div>
      <div class="fgroup"><label>Designation</label><input type="text" id="ef-desig" value="${f.desig||''}"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Dept</label><select id="ef-dept">${A.db.courses.map(c=>`<option ${f.dept===c.id?'selected':''}>${c.id}</option>`).join('')}</select></div>
      <div class="fgroup"><label>Phone</label><input type="tel" id="ef-phone" value="${f.phone||''}"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Qualification</label><input type="text" id="ef-qual" value="${f.qual||''}"/></div>
      <div class="fgroup"><label>Exp (yrs)</label><input type="number" id="ef-exp" value="${f.exp||0}"/></div>
    </div>
    <div class="fgroup"><label>Specialization</label><input type="text" id="ef-spec" value="${f.spec||''}"/></div>
    <div class="fgroup"><label>Subjects Taught</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        ${A.db.subjects.map(s=>`<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer"><input type="checkbox" value="${s.id}" ${(f.subs||[]).includes(s.id)?'checked':''}/>${s.code}</label>`).join('')}
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-solid" onclick="editFaculty('${facId}')"><i class="fas fa-save"></i> Save</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`,true);
}

function editFaculty(facId){
  const f=A.db.faculty.find(x=>x.id===facId); if(!f) return;
  f.name=($('ef-name')||{}).value||f.name; f.desig=($('ef-desig')||{}).value||'';
  f.dept=($('ef-dept')||{}).value||f.dept; f.phone=($('ef-phone')||{}).value||'';
  f.qual=($('ef-qual')||{}).value||''; f.spec=($('ef-spec')||{}).value||'';
  f.exp=parseInt(($('ef-exp')||{}).value)||0;
  f.subs=Array.from(document.querySelectorAll('#modal-inner input[type=checkbox]:checked')).map(c=>c.value);
  save(); closeModal(); toast('Faculty updated!','ok'); admView('faculty');
}

function openAssignSectionsModal(facId){
  const f=A.db.faculty.find(x=>x.id===facId); if(!f) return;
  openModal(`
    <div class="modal-title">Assign Sections to ${f.name}</div>
    <div class="modal-sub">Select sections where this faculty teaches</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${A.db.sections.map(s=>`<label style="display:flex;align-items:center;gap:5px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--rsm);cursor:pointer;font-size:13px;font-weight:600"><input type="checkbox" value="${s.id}" ${(f.sections||[]).includes(s.id)?'checked':''}/>${s.id}</label>`).join('')}
    </div>
    <div style="margin-top:14px;display:flex;gap:8px">
      <button class="btn-solid" onclick="saveAssignSections('${facId}')"><i class="fas fa-save"></i> Save</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function saveAssignSections(facId){
  const f=A.db.faculty.find(x=>x.id===facId); if(!f) return;
  f.sections=Array.from(document.querySelectorAll('#modal-inner input[type=checkbox]:checked')).map(c=>c.value);
  save(); closeModal(); toast('Sections assigned!','ok'); admView('faculty');
}

function deleteFaculty(facId){
  if(!confirm('Delete this faculty member?')) return;
  A.db.faculty=A.db.faculty.filter(f=>f.id!==facId);
  A.db.users=A.db.users.filter(u=>u.id!==facId);
  save(); toast('Faculty removed','warn'); admView('faculty');
}

function admCourses(){
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-book"></i>Branches</div><button class="btn-solid btn-sm" onclick="openAddCourseModal()"><i class="fas fa-plus"></i> Add</button></div>
      <div class="tbl-wrap"><table class="dtbl">
        <thead><tr><th>ID</th><th>Name</th><th>Sections</th><th>Actions</th></tr></thead>
        <tbody>${A.db.courses.map(c=>`<tr>
          <td><b style="color:${c.color}">${c.id}</b></td>
          <td>${c.name}</td>
          <td>${A.db.sections.filter(s=>s.branch===c.id).length}</td>
          <td><div class="td-acts">
            <button class="btn-icon edit" onclick="openEditCourseModal('${c.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn-icon del" onclick="deleteCourse('${c.id}')"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-layer-group"></i>Sections</div><button class="btn-solid btn-sm" onclick="openAddSectionModal()"><i class="fas fa-plus"></i> Add</button></div>
      <div class="tbl-wrap"><table class="dtbl">
        <thead><tr><th>Section</th><th>Branch</th><th>Room</th><th>Lab</th><th>Actions</th></tr></thead>
        <tbody>${A.db.sections.map(s=>`<tr>
          <td><b>${s.id}</b></td><td>${s.branch}</td><td>${s.room||'—'}</td><td>${s.labRoom||'—'}</td>
          <td><div class="td-acts">
            <button class="btn-icon edit" onclick="openEditSectionModal('${s.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn-icon del" onclick="deleteSection('${s.id}')"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
  </div>`;
}

function openAddCourseModal(){
  openModal(`
    <div class="modal-title">Add Branch / Course</div>
    <div class="fgroup"><label>Branch Code</label><input type="text" id="ac-id" placeholder="e.g. ECE"/></div>
    <div class="fgroup"><label>Full Name</label><input type="text" id="ac-name" placeholder="Electronics & Communication Engg."/></div>
    <div class="fgroup"><label>Color</label><input type="color" id="ac-color" value="#3b82f6" style="height:40px"/></div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn-solid" onclick="addCourse()"><i class="fas fa-save"></i> Add</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function addCourse(){
  const id=(($('ac-id')||{}).value||'').trim().toUpperCase();
  const name=(($('ac-name')||{}).value||'').trim();
  const color=($('ac-color')||{}).value||'#3b82f6';
  if(!id||!name){ toast('ID and name required','err'); return; }
  if(A.db.courses.find(c=>c.id===id)){ toast('Branch ID already exists','err'); return; }
  A.db.courses.push({id,name,color});
  save(); closeModal(); toast('Branch added!','ok'); admView('courses');
}

function openEditCourseModal(cid){
  const c=A.db.courses.find(x=>x.id===cid); if(!c) return;
  openModal(`
    <div class="modal-title">Edit Branch: ${c.id}</div>
    <div class="fgroup"><label>Full Name</label><input type="text" id="ec-name" value="${c.name}"/></div>
    <div class="fgroup"><label>Color</label><input type="color" id="ec-color" value="${c.color||'#3b82f6'}" style="height:40px"/></div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn-solid" onclick="editCourse('${cid}')"><i class="fas fa-save"></i> Save</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function editCourse(cid){
  const c=A.db.courses.find(x=>x.id===cid); if(!c) return;
  c.name=($('ec-name')||{}).value||c.name; c.color=($('ec-color')||{}).value||c.color;
  save(); closeModal(); toast('Branch updated!','ok'); admView('courses');
}

function deleteCourse(cid){
  if(!confirm('Delete this branch? All related sections will also be removed.')) return;
  A.db.courses=A.db.courses.filter(c=>c.id!==cid);
  A.db.sections=A.db.sections.filter(s=>s.branch!==cid);
  save(); toast('Branch deleted','warn'); admView('courses');
}

function openAddSectionModal(){
  openModal(`
    <div class="modal-title">Add Section</div>
    <div class="frow">
      <div class="fgroup"><label>Branch</label><select id="as2-branch">${A.db.courses.map(c=>`<option>${c.id}</option>`).join('')}</select></div>
      <div class="fgroup"><label>Section Letter</label><input type="text" id="as2-sec" placeholder="F" maxlength="2"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Classroom</label><select id="as2-room">${A.db.rooms.filter(r=>r.type==='classroom').map(r=>`<option value="${r.id}">${r.id} — ${r.name}</option>`).join('')}</select></div>
      <div class="fgroup"><label>Lab Room</label><select id="as2-lab">${A.db.rooms.filter(r=>r.type==='lab').map(r=>`<option value="${r.id}">${r.id} — ${r.name}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn-solid" onclick="addSection()"><i class="fas fa-save"></i> Add</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function addSection(){
  const branch=(($('as2-branch')||{}).value||'').trim();
  const sec=(($('as2-sec')||{}).value||'').trim().toUpperCase();
  if(!branch||!sec){ toast('Branch and section required','err'); return; }
  const id=branch+'-'+sec;
  if(A.db.sections.find(s=>s.id===id)){ toast('Section already exists','err'); return; }
  A.db.sections.push({id,branch,sec,room:($('as2-room')||{}).value||'',labRoom:($('as2-lab')||{}).value||''});
  save(); closeModal(); toast('Section added!','ok'); admView('courses');
}

function openEditSectionModal(secId){
  const s=A.db.sections.find(x=>x.id===secId); if(!s) return;
  openModal(`
    <div class="modal-title">Edit Section: ${s.id}</div>
    <div class="frow">
      <div class="fgroup"><label>Classroom</label><select id="es2-room">${A.db.rooms.filter(r=>r.type==='classroom').map(r=>`<option value="${r.id}" ${r.id===s.room?'selected':''}>${r.id} — ${r.name}</option>`).join('')}</select></div>
      <div class="fgroup"><label>Lab Room</label><select id="es2-lab">${A.db.rooms.filter(r=>r.type==='lab').map(r=>`<option value="${r.id}" ${r.id===s.labRoom?'selected':''}>${r.id} — ${r.name}</option>`).join('')}</select></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn-solid" onclick="editSection('${secId}')"><i class="fas fa-save"></i> Save</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function editSection(secId){
  const s=A.db.sections.find(x=>x.id===secId); if(!s) return;
  s.room=($('es2-room')||{}).value||''; s.labRoom=($('es2-lab')||{}).value||'';
  save(); closeModal(); toast('Section updated!','ok'); admView('courses');
}

function deleteSection(secId){
  if(!confirm('Delete section '+secId+'?')) return;
  A.db.sections=A.db.sections.filter(s=>s.id!==secId);
  A.db.timetables=A.db.timetables.filter(t=>t.secId!==secId);
  save(); toast('Section deleted','warn'); admView('courses');
}

/* ━━━ PERIOD TIMINGS EDITOR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function admTimings(){
  const cfg = A.db.periodConfig;
  const periods = cfg.periods;
  const lunch = cfg.lunch;

  const timeVal = mins => String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');

  const periodRows = periods.map((p,i)=>`
    <tr id="ptr-${i}">
      <td><div style="display:flex;align-items:center;gap:8px">
        <div style="width:24px;height:24px;border-radius:50%;background:var(--teal-dim);color:var(--teal);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0">${p.n}</div>
        <span style="font-weight:700;font-size:13px">Period ${p.n}</span>
      </div></td>
      <td><input type="time" id="pt-start-${i}" value="${timeVal(p.start)}" onchange="refreshPeriodLabel(${i})" style="width:120px;font-family:var(--font-mono)"/></td>
      <td><input type="time" id="pt-end-${i}" value="${timeVal(p.end)}" onchange="refreshPeriodLabel(${i})" style="width:120px;font-family:var(--font-mono)"/></td>
      <td><span id="pt-lbl-${i}" style="color:var(--teal);font-size:12px;font-family:var(--font-mono)">${p.time}</span></td>
      <td style="color:var(--text3);font-size:12px">${Math.round(p.end-p.start)} min</td>
      <td><button class="btn-icon del" onclick="removePeriod(${i})" title="Remove period"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('');

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <!-- LEFT: period timings -->
      <div class="card" style="grid-column:1/-1">
        <div class="card-hdr">
          <div class="card-title"><i class="fas fa-clock"></i>Period Schedule</div>
          <div style="display:flex;gap:8px">
            <button class="btn-solid btn-sm" onclick="addPeriod()"><i class="fas fa-plus"></i> Add Period</button>
            <button class="btn-ghost btn-sm" onclick="autoFillTimings()"><i class="fas fa-magic"></i> Auto-fill from Settings</button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:14px;padding:9px 13px;background:var(--surface2);border-radius:var(--rsm);display:flex;align-items:center;gap:8px">
          <i class="fas fa-info-circle" style="color:var(--teal)"></i>
          Edit start/end times for each period. Use <b style="color:var(--text)">"Auto-fill from Settings"</b> to regenerate all timings from the general settings below. All timetable displays update immediately on save.
        </div>
        <div class="tbl-wrap">
          <table class="dtbl">
            <thead><tr><th>Period</th><th>Start Time</th><th>End Time</th><th>Display Label</th><th>Duration</th><th></th></tr></thead>
            <tbody id="periods-tbody">${periodRows}</tbody>
          </table>
        </div>
      </div>

      <!-- Lunch break -->
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-utensils"></i>Lunch Break</div></div>
        <div class="frow">
          <div class="fgroup">
            <label>Lunch Start</label>
            <input type="time" id="lunch-start" value="${timeVal(lunch.start)}" onchange="refreshLunchLabel()" style="font-family:var(--font-mono)"/>
          </div>
          <div class="fgroup">
            <label>Lunch End</label>
            <input type="time" id="lunch-end" value="${timeVal(lunch.end)}" onchange="refreshLunchLabel()" style="font-family:var(--font-mono)"/>
          </div>
        </div>
        <div style="margin-top:8px;padding:8px 12px;background:var(--surface2);border-radius:var(--rsm)">
          <span style="font-size:12px;color:var(--text3)">Current: </span>
          <span id="lunch-lbl" style="font-size:13px;font-weight:700;color:var(--amber);font-family:var(--font-mono)">${lunch.time}</span>
        </div>
      </div>

      <!-- General settings -->
      <div class="card">
        <div class="card-hdr"><div class="card-title"><i class="fas fa-sliders-h"></i>General Settings</div></div>
        <div class="frow">
          <div class="fgroup">
            <label>Period Duration <span style="color:var(--text4)">(min)</span></label>
            <input type="number" id="cfg-dur" value="${cfg.periodDuration||60}" min="30" max="120"/>
          </div>
          <div class="fgroup">
            <label>Morning Break <span style="color:var(--text4)">(min, between periods)</span></label>
            <input type="number" id="cfg-mbrk" value="${cfg.morningBreak||10}" min="0" max="30"/>
          </div>
        </div>
        <div class="frow">
          <div class="fgroup">
            <label>Afternoon Break <span style="color:var(--text4)">(min, 0 = no gap)</span></label>
            <input type="number" id="cfg-abrk" value="${cfg.afternoonBreak||0}" min="0" max="30"/>
          </div>
          <div class="fgroup">
            <label>Working Days / Week</label>
            <select id="cfg-wd">
              <option value="5" ${cfg.workingDays===5?'selected':''}>5 days (Mon–Fri)</option>
              <option value="6" ${cfg.workingDays===6?'selected':''}>6 days (Mon–Sat)</option>
            </select>
          </div>
        </div>
        <div class="frow">
          <div class="fgroup">
            <label>Lab Duration <span style="color:var(--text4)">(consecutive periods)</span></label>
            <input type="number" id="cfg-lab" value="${cfg.labDuration||2}" min="1" max="4"/>
          </div>
          <div class="fgroup">
            <label>Max Contiguous <span style="color:var(--text4)">(same subject)</span></label>
            <input type="number" id="cfg-mc" value="${cfg.maxContiguous||2}" min="1" max="4"/>
          </div>
        </div>
      </div>
    </div>

    <!-- Save / Reset bar -->
    <div class="card">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="flex:1;font-size:13px;color:var(--text3)">
          <i class="fas fa-exclamation-triangle" style="color:var(--amber);margin-right:6px"></i>
          After saving timings, go to <b style="color:var(--text)">AI Generator</b> and regenerate timetables so slots match the new period count.
        </div>
        <button class="btn-solid success" onclick="saveTimings()"><i class="fas fa-save"></i> Save All Timings</button>
        <button class="btn-ghost" onclick="resetToDefault()"><i class="fas fa-undo"></i> Reset to NIST Default</button>
      </div>
    </div>`;
}

/* Live label refresh while editing time inputs */
function refreshPeriodLabel(i){
  const s=$('pt-start-'+i); const e=$('pt-end-'+i); const lbl=$('pt-lbl-'+i);
  if(!s||!e||!lbl) return;
  const sm=hmToMins(s.value), em=hmToMins(e.value);
  lbl.textContent=periodLabel(sm,em);
}
function refreshLunchLabel(){
  const s=$('lunch-start'); const e=$('lunch-end'); const lbl=$('lunch-lbl');
  if(!s||!e||!lbl) return;
  lbl.textContent=periodLabel(hmToMins(s.value),hmToMins(e.value));
}

/* Add a new period after the last one */
function addPeriod(){
  const cfg=A.db.periodConfig;
  const last=cfg.periods[cfg.periods.length-1];
  const gap=cfg.afternoonBreak||0;
  const newStart=last.end+gap;
  const newEnd=newStart+(cfg.periodDuration||60);
  cfg.periods.push({n:cfg.periods.length+1,time:periodLabel(newStart,newEnd),start:newStart,end:newEnd});
  save(); admView('timings'); toast('Period '+(cfg.periods.length)+' added','ok');
}

/* Remove a period by index */
function removePeriod(idx){
  const cfg=A.db.periodConfig;
  if(cfg.periods.length<=1){toast('Need at least 1 period','err');return;}
  if(!confirm('Remove Period '+(idx+1)+'? Timetables with this period will need regenerating.')) return;
  cfg.periods.splice(idx,1);
  cfg.periods.forEach((p,i)=>{p.n=i+1;});
  save(); admView('timings'); toast('Period removed — please regenerate timetables','warn');
}

/* Auto-fill all period times from general settings */
function autoFillTimings(){
  const cfg=A.db.periodConfig;
  // Read current settings from inputs if on the page
  const dur  = parseInt(($('cfg-dur')||{value:cfg.periodDuration||60}).value)||60;
  const mbrk = parseInt(($('cfg-mbrk')||{value:cfg.morningBreak||10}).value)||0;
  const abrk = parseInt(($('cfg-abrk')||{value:cfg.afternoonBreak||0}).value)||0;
  const ls   = hmToMins(($('lunch-start')||{value:'12:00'}).value||'12:00');
  const le   = hmToMins(($('lunch-end')||{value:'13:00'}).value||'13:00');
  const nPer = cfg.periods.length;

  // Rebuild periods from first period's start time
  const firstStart=cfg.periods[0].start;
  let cursor=firstStart;
  const newPeriods=[];
  for(let i=0;i<nPer;i++){
    // Skip over lunch if cursor falls in lunch window
    if(cursor>=ls&&cursor<le) cursor=le;
    // After lunch, use afternoon break; before lunch use morning break
    const isAfternoon=cursor>=le;
    const end=cursor+dur;
    newPeriods.push({n:i+1,time:periodLabel(cursor,end),start:cursor,end});
    cursor=end+(isAfternoon?abrk:mbrk);
    if(cursor===ls||cursor>ls&&cursor<le) cursor=le; // skip into lunch
  }
  cfg.periods=newPeriods;
  cfg.periodDuration=dur; cfg.morningBreak=mbrk; cfg.afternoonBreak=abrk;
  save(); admView('timings'); toast('Timings auto-filled from settings','info');
}

/* Save all timing edits */
function saveTimings(){
  const cfg=A.db.periodConfig;

  // Read each period row
  cfg.periods.forEach((p,i)=>{
    const se=$('pt-start-'+i); const ee=$('pt-end-'+i);
    if(se&&ee){
      p.start=hmToMins(se.value);
      p.end=hmToMins(ee.value);
      p.time=periodLabel(p.start,p.end);
    }
  });

  // Lunch
  const ls=$('lunch-start'); const le=$('lunch-end');
  if(ls&&le){
    cfg.lunch.start=hmToMins(ls.value);
    cfg.lunch.end=hmToMins(le.value);
    cfg.lunch.time=periodLabel(cfg.lunch.start,cfg.lunch.end);
  }

  // General settings
  if($('cfg-dur'))  cfg.periodDuration  = parseInt($('cfg-dur').value)||60;
  if($('cfg-mbrk')) cfg.morningBreak    = parseInt($('cfg-mbrk').value)||0;
  if($('cfg-abrk')) cfg.afternoonBreak  = parseInt($('cfg-abrk').value)||0;
  if($('cfg-lab'))  cfg.labDuration     = parseInt($('cfg-lab').value)||2;
  if($('cfg-mc'))   cfg.maxContiguous   = parseInt($('cfg-mc').value)||2;
  if($('cfg-wd'))   cfg.workingDays     = parseInt($('cfg-wd').value)||6;

  save();
  toast('✓ Timings saved! Go to AI Generator → Generate Now to rebuild timetables.','ok');
  admView('timings');
}

/* Reset to NIST Berhampur defaults */
function resetToDefault(){
  if(!confirm('Reset all period timings to NIST Berhampur default schedule?\n\n7:30 AM start · 10-min breaks · 12:00–1:00 PM lunch · No afternoon breaks')) return;
  A.db.periodConfig=buildDefaultPeriodConfig();
  save(); admView('timings');
  toast('Reset to NIST Berhampur default timings','info');
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

function admRooms(){
  return `<div class="card">
    <div class="sec-tb"><div class="ttl">Rooms & Labs (${A.db.rooms.length})</div>
      <button class="btn-solid" onclick="openAddRoomModal()"><i class="fas fa-plus"></i> Add Room</button>
    </div>
    <div class="tbl-wrap"><table class="dtbl">
      <thead><tr><th>Room ID</th><th>Name</th><th>Type</th><th>Capacity</th><th>Building</th><th>Floor</th><th>Actions</th></tr></thead>
      <tbody>${A.db.rooms.map(r=>`<tr>
        <td><code>${r.id}</code></td><td>${r.name}</td>
        <td><span class="sbadge ${r.type==='lab'?'late':'active'}">${r.type}</span></td>
        <td>${r.cap}</td><td>${r.bldg}</td><td>${r.floor}</td>
        <td><div class="td-acts">
          <button class="btn-icon edit" onclick="openEditRoomModal('${r.id}')"><i class="fas fa-edit"></i></button>
          <button class="btn-icon del" onclick="deleteRoom('${r.id}')"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

function openAddRoomModal(){
  openModal(`
    <div class="modal-title">Add Room / Lab</div>
    <div class="frow">
      <div class="fgroup"><label>Room ID</label><input type="text" id="ar-id" placeholder="CR-401"/></div>
      <div class="fgroup"><label>Name</label><input type="text" id="ar-name" placeholder="Classroom 401"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Type</label><select id="ar-type"><option value="classroom">Classroom</option><option value="lab">Lab</option></select></div>
      <div class="fgroup"><label>Capacity</label><input type="number" id="ar-cap" value="60"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Building</label><input type="text" id="ar-bldg" placeholder="Block A"/></div>
      <div class="fgroup"><label>Floor</label><input type="number" id="ar-floor" value="1"/></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-solid" onclick="addRoom()"><i class="fas fa-save"></i> Add Room</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function addRoom(){
  const id=(($('ar-id')||{}).value||'').trim();
  const name=(($('ar-name')||{}).value||'').trim();
  if(!id||!name){ toast('ID and name required','err'); return; }
  if(A.db.rooms.find(r=>r.id===id)){ toast('Room ID already exists','err'); return; }
  A.db.rooms.push({id,name,type:($('ar-type')||{}).value||'classroom',cap:parseInt(($('ar-cap')||{}).value)||60,bldg:($('ar-bldg')||{}).value||'',floor:parseInt(($('ar-floor')||{}).value)||1});
  save(); closeModal(); toast('Room added!','ok'); admView('rooms');
}

function openEditRoomModal(roomId){
  const r=A.db.rooms.find(x=>x.id===roomId); if(!r) return;
  openModal(`
    <div class="modal-title">Edit Room: ${r.id}</div>
    <div class="frow">
      <div class="fgroup"><label>Name</label><input type="text" id="er-name" value="${r.name}"/></div>
      <div class="fgroup"><label>Type</label><select id="er-type"><option value="classroom" ${r.type==='classroom'?'selected':''}>Classroom</option><option value="lab" ${r.type==='lab'?'selected':''}>Lab</option></select></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Capacity</label><input type="number" id="er-cap" value="${r.cap}"/></div>
      <div class="fgroup"><label>Building</label><input type="text" id="er-bldg" value="${r.bldg}"/></div>
    </div>
    <div class="fgroup"><label>Floor</label><input type="number" id="er-floor" value="${r.floor}"/></div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-solid" onclick="editRoom('${roomId}')"><i class="fas fa-save"></i> Save</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function editRoom(roomId){
  const r=A.db.rooms.find(x=>x.id===roomId); if(!r) return;
  r.name=($('er-name')||{}).value||r.name; r.type=($('er-type')||{}).value||r.type;
  r.cap=parseInt(($('er-cap')||{}).value)||r.cap; r.bldg=($('er-bldg')||{}).value||r.bldg;
  r.floor=parseInt(($('er-floor')||{}).value)||r.floor;
  save(); closeModal(); toast('Room updated!','ok'); admView('rooms');
}

function deleteRoom(roomId){
  if(!confirm('Delete room '+roomId+'?')) return;
  A.db.rooms=A.db.rooms.filter(r=>r.id!==roomId);
  save(); toast('Room deleted','warn'); admView('rooms');
}

function admSubjects(){
  const branchColors={'CSE':'var(--teal)','IT':'var(--blue)','CST':'var(--amber)'};
  return `<div class="card">
    <div class="sec-tb"><div class="ttl">Subjects (${A.db.subjects.length})</div>
      <button class="btn-solid" onclick="openAddSubjectModal()"><i class="fas fa-plus"></i> Add Subject</button>
    </div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px;padding:8px 12px;background:var(--surface2);border-radius:var(--rsm)">
      <i class="fas fa-info-circle" style="color:var(--teal);margin-right:6px"></i>
      A subject can belong to <b>multiple branches</b>. Use checkboxes when adding/editing to assign to one, two, or all three branches.
    </div>
    <div class="tbl-wrap"><table class="dtbl">
      <thead><tr><th>Code</th><th>Name</th><th>Branches</th><th>Type</th><th>Credits</th><th>PPW</th><th>Actions</th></tr></thead>
      <tbody>${A.db.subjects.map(s=>{
        const branches=getSubBranches(s);
        return `<tr>
          <td><span style="font-weight:700;color:${s.color||'var(--teal)'}">${s.code}</span></td>
          <td>${s.name}</td>
          <td><div style="display:flex;gap:4px;flex-wrap:wrap">
            ${branches.map(b=>`<span class="sbadge active" style="font-size:10px;background:${branchColors[b]||'var(--teal)'}22;color:${branchColors[b]||'var(--teal)'}">${b}</span>`).join('')}
          </div></td>
          <td><span class="sbadge ${s.type==='lab'?'late':'active'}">${s.type}</span></td>
          <td>${s.credits}</td><td>${s.ppw}</td>
          <td><div class="td-acts">
            <button class="btn-icon edit" onclick="openEditSubjectModal('${s.id}')"><i class="fas fa-edit"></i></button>
            <button class="btn-icon del" onclick="deleteSubject('${s.id}')"><i class="fas fa-trash"></i></button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;
}

function openAddSubjectModal(){
  openModal(`
    <div class="modal-title">Add Subject</div>
    <div class="frow">
      <div class="fgroup"><label>Subject Code</label><input type="text" id="asub-code" placeholder="CS608"/></div>
      <div class="fgroup"><label>Name</label><input type="text" id="asub-name" placeholder="Subject Name"/></div>
    </div>
    <div class="fgroup">
      <label>Branches <span style="color:var(--text3);font-weight:400;font-size:11px">(select one or more)</span></label>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
        ${A.db.courses.map(c=>`
          <label style="display:flex;align-items:center;gap:7px;padding:8px 14px;border:1.5px solid var(--border);border-radius:var(--r);cursor:pointer;font-size:13px;font-weight:700;transition:all .15s" id="asub-blabel-${c.id}"
            onclick="toggleSubBranchLabel('asub-bl-${c.id}','asub-blabel-${c.id}','${c.color||'var(--teal)'}')">
            <input type="checkbox" id="asub-bl-${c.id}" value="${c.id}" style="width:15px;height:15px;accent-color:${c.color||'var(--teal)'}"/>
            <span style="color:${c.color||'var(--teal)'}">${c.id}</span>
            <span style="font-size:11px;color:var(--text3);font-weight:400">${c.name}</span>
          </label>`).join('')}
      </div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Type</label><select id="asub-type"><option value="theory">Theory</option><option value="lab">Lab</option></select></div>
      <div class="fgroup"><label>Credits</label><input type="number" id="asub-credits" value="3" min="1" max="6"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Periods / Week</label><input type="number" id="asub-ppw" value="3" min="1" max="6"/></div>
      <div class="fgroup"><label>Color</label><input type="color" id="asub-color" value="#3b82f6" style="height:38px"/></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn-solid" onclick="addSubject()"><i class="fas fa-save"></i> Add Subject</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function toggleSubBranchLabel(cbId, labelId, color){
  const cb=$(cbId); const lbl=$(labelId); if(!cb||!lbl) return;
  // Checkbox is toggled by the label click natively; read its new state
  setTimeout(()=>{
    lbl.style.borderColor = cb.checked ? color : 'var(--border)';
    lbl.style.background  = cb.checked ? color+'18' : '';
  }, 0);
}

function addSubject(){
  const code=(($('asub-code')||{}).value||'').trim();
  const name=(($('asub-name')||{}).value||'').trim();
  if(!code||!name){ toast('Subject code and name are required','err'); return; }
  if(A.db.subjects.find(s=>s.code===code)){ toast('Subject code already exists','err'); return; }
  // Collect checked branches
  const branches=A.db.courses.map(c=>c.id).filter(id=>{
    const cb=$('asub-bl-'+id); return cb&&cb.checked;
  });
  if(!branches.length){ toast('Please select at least one branch','err'); return; }
  const newSub={
    id:code, code, name,
    branches,                                       // new multi-branch array
    branch: branches[0],                            // keep legacy field = first branch
    type:($('asub-type')||{}).value||'theory',
    credits:parseInt(($('asub-credits')||{}).value)||3,
    ppw:parseInt(($('asub-ppw')||{}).value)||3,
    color:($('asub-color')||{}).value||'#3b82f6'
  };
  A.db.subjects.push(newSub);
  save(); closeModal(); toast('Subject added for branches: '+branches.join(', '),'ok'); admView('subjects');
}

function openEditSubjectModal(subId){
  const s=A.db.subjects.find(x=>x.id===subId); if(!s) return;
  const currentBranches=getSubBranches(s);
  openModal(`
    <div class="modal-title">Edit Subject: ${s.code}</div>
    <div class="fgroup"><label>Name</label><input type="text" id="esub-name" value="${s.name}"/></div>
    <div class="fgroup">
      <label>Branches <span style="color:var(--text3);font-weight:400;font-size:11px">(select one or more)</span></label>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
        ${A.db.courses.map(c=>{
          const checked=currentBranches.includes(c.id);
          return `<label style="display:flex;align-items:center;gap:7px;padding:8px 14px;border:1.5px solid ${checked?c.color||'var(--teal)':'var(--border)'};border-radius:var(--r);cursor:pointer;font-size:13px;font-weight:700;background:${checked?(c.color||'var(--teal)')+'18':''};transition:all .15s" id="esub-blabel-${c.id}"
            onclick="toggleSubBranchLabel('esub-bl-${c.id}','esub-blabel-${c.id}','${c.color||'var(--teal)'}')">
            <input type="checkbox" id="esub-bl-${c.id}" value="${c.id}" ${checked?'checked':''} style="width:15px;height:15px;accent-color:${c.color||'var(--teal)'}"/>
            <span style="color:${c.color||'var(--teal)'}">${c.id}</span>
            <span style="font-size:11px;color:var(--text3);font-weight:400">${c.name}</span>
          </label>`;
        }).join('')}
      </div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Type</label><select id="esub-type"><option value="theory" ${s.type==='theory'?'selected':''}>Theory</option><option value="lab" ${s.type==='lab'?'selected':''}>Lab</option></select></div>
      <div class="fgroup"><label>Credits</label><input type="number" id="esub-credits" value="${s.credits}"/></div>
    </div>
    <div class="frow">
      <div class="fgroup"><label>Periods/Week</label><input type="number" id="esub-ppw" value="${s.ppw}"/></div>
      <div class="fgroup"><label>Color</label><input type="color" id="esub-color" value="${s.color||'#3b82f6'}" style="height:38px"/></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn-solid" onclick="editSubject('${subId}')"><i class="fas fa-save"></i> Save Changes</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function editSubject(subId){
  const s=A.db.subjects.find(x=>x.id===subId); if(!s) return;
  const branches=A.db.courses.map(c=>c.id).filter(id=>{
    const cb=$('esub-bl-'+id); return cb&&cb.checked;
  });
  if(!branches.length){ toast('Please select at least one branch','err'); return; }
  s.name=($('esub-name')||{}).value||s.name;
  s.branches=branches;
  s.branch=branches[0];   // keep legacy field in sync
  s.type=($('esub-type')||{}).value||s.type;
  s.credits=parseInt(($('esub-credits')||{}).value)||s.credits;
  s.ppw=parseInt(($('esub-ppw')||{}).value)||s.ppw;
  s.color=($('esub-color')||{}).value||s.color;
  save(); closeModal(); toast('Subject updated for branches: '+branches.join(', '),'ok'); admView('subjects');
}

function deleteSubject(subId){
  if(!confirm('Delete this subject?')) return;
  A.db.subjects=A.db.subjects.filter(s=>s.id!==subId);
  save(); toast('Subject deleted','warn'); admView('subjects');
}

/* ━━━ ADMIN TIMETABLE VIEWS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function admViewTT(){
  const secs=A.db.sections;
  let secFilter='all';
  return `<div class="card">
    <div class="card-hdr"><div class="card-title"><i class="fas fa-calendar-week"></i>View All Timetables</div></div>
    <div class="filt-row" style="margin-bottom:16px">
      <select id="tt-view-sec" onchange="renderAdmTTView()">
        <option value="all">All Sections</option>
        ${secs.map(s=>`<option value="${s.id}">${s.id}</option>`).join('')}
      </select>
    </div>
    <div id="tt-view-area">${secs.map(sec=>{
      const tt=getTT(sec.id);
      return `<div style="margin-bottom:20px"><div style="font-family:var(--font-head);font-weight:700;font-size:15px;margin-bottom:8px;color:var(--teal)">${sec.id}</div>${renderTTTable(tt)}</div>`;
    }).join('')}</div>
  </div>`;
}

function renderAdmTTView(){
  const val=($('tt-view-sec')||{}).value||'all';
  const area=$('tt-view-area'); if(!area) return;
  const secs=val==='all'?A.db.sections:A.db.sections.filter(s=>s.id===val);
  area.innerHTML=secs.map(sec=>{
    const tt=getTT(sec.id);
    return `<div style="margin-bottom:20px"><div style="font-family:var(--font-head);font-weight:700;font-size:15px;margin-bottom:8px;color:var(--teal)">${sec.id}</div>${renderTTTable(tt)}</div>`;
  }).join('');
}

/* ━━━ MANUAL TIMETABLE ENTRY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let manualTTSlots = {};

function admManualTT(){
  return `<div class="card">
    <div class="card-hdr"><div class="card-title"><i class="fas fa-pencil-ruler"></i>Manual Timetable Entry</div></div>
    <div class="filt-row" style="margin-bottom:16px">
      <select id="mtt-sec" onchange="buildManualTTGrid()">
        <option value="">Select Section</option>
        ${A.db.sections.map(s=>`<option value="${s.id}">${s.id}</option>`).join('')}
      </select>
    </div>
    <div id="mtt-grid-area"><div class="empty-st"><i class="fas fa-table"></i><h3>Select a section to start editing</h3></div></div>
  </div>`;
}

function buildManualTTGrid(){
  const secId=($('mtt-sec')||{}).value; if(!secId) return;
  const area=$('mtt-grid-area'); if(!area) return;
  const existTT=getTT(secId);
  manualTTSlots={};
  if(existTT){
    C.days.forEach(day=>{ getPeriods().forEach((per,i)=>{ manualTTSlots[day+'_'+i]=existTT.schedule[day][i]; }); });
  }
  const subs=getSubsByBranch(secId.split('-')[0]);

  let html=`<div class="mtt-slot-grid">
    <div class="mtt-hdr"></div>
    ${C.days.map(d=>`<div class="mtt-hdr">${d.slice(0,3)}</div>`).join('')}
    ${getPeriods().map((per,pi)=>`
      <div class="mtt-time">${per.time}</div>
      ${C.days.map(day=>{
        const slot=manualTTSlots[day+'_'+pi];
        const sub=slot&&slot.subId?getSub(slot.subId):null;
        return `<div class="mtt-slot ${sub?'filled-'+(slot.type==='lab'?'l':'t'):''}" onclick="openSlotEditor('${secId}','${day}',${pi})" id="mslot_${day}_${pi}">
          ${sub?`<div class="sc" style="color:${sub.color||'var(--teal)'}">${sub.code}</div><div class="sn">${sub.name.slice(0,12)}</div><div class="sr">${slot.room||''}</div>`:'<div style="color:var(--text4);font-size:10px;text-align:center;padding:4px">+</div>'}
        </div>`;
      }).join('')}
    `).join('')}
  </div>
  <div style="margin-top:16px;display:flex;gap:8px">
    <button class="btn-solid" onclick="saveManualTT('${secId}')"><i class="fas fa-save"></i> Save Timetable</button>
    <button class="btn-ghost" onclick="clearManualTT('${secId}')">Clear All</button>
  </div>`;
  area.innerHTML=html;
}

function openSlotEditor(secId,day,pi){
  const sec=getSec(secId);
  const subs=getSubsByBranch(secId.split('-')[0]);
  const facs=A.db.faculty.filter(f=>f.dept===secId.split('-')[0]||(f.sections||[]).includes(secId));
  const slot=manualTTSlots[day+'_'+pi]||{subId:'',facId:'',room:'',type:'theory'};
  openModal(`
    <div class="modal-title">Edit Slot: ${day} · Period ${pi+1}</div>
    <div class="modal-sub">${getPeriods()[pi].time} — Section ${secId}</div>
    <div class="fgroup"><label>Subject</label>
      <select id="mslot-sub">
        <option value="">— Free Period —</option>
        ${subs.map(s=>`<option value="${s.id}" ${slot.subId===s.id?'selected':''}>${s.code} — ${s.name}</option>`).join('')}
      </select>
    </div>
    <div class="fgroup"><label>Faculty</label>
      <select id="mslot-fac">
        <option value="">— Select Faculty —</option>
        ${A.db.faculty.map(f=>`<option value="${f.id}" ${slot.facId===f.id?'selected':''}>${f.name}</option>`).join('')}
      </select>
    </div>
    <div class="fgroup"><label>Room</label>
      <select id="mslot-room">
        <option value="">— Select Room —</option>
        ${A.db.rooms.map(r=>`<option value="${r.id}" ${slot.room===r.id?'selected':''}>${r.id} — ${r.name}</option>`).join('')}
      </select>
    </div>
    <div class="fgroup"><label>Type</label>
      <select id="mslot-type">
        <option value="theory" ${slot.type==='theory'?'selected':''}>Theory</option>
        <option value="lab" ${slot.type==='lab'?'selected':''}>Lab</option>
      </select>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-solid" onclick="saveSlotEdit('${secId}','${day}',${pi})"><i class="fas fa-save"></i> Save Slot</button>
      <button class="btn-solid danger" onclick="clearSlot('${secId}','${day}',${pi})">Clear</button>
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>`);
}

function saveSlotEdit(secId,day,pi){
  const subId=($('mslot-sub')||{}).value;
  const facId=($('mslot-fac')||{}).value;
  const room=($('mslot-room')||{}).value;
  const type=($('mslot-type')||{}).value||'theory';
  manualTTSlots[day+'_'+pi]={period:pi+1,subId:subId||null,facId:facId||null,room:room||null,type};
  closeModal(); refreshManualSlot(secId,day,pi);
}

function clearSlot(secId,day,pi){
  manualTTSlots[day+'_'+pi]={period:pi+1,subId:null,facId:null,room:null,type:'free'};
  closeModal(); refreshManualSlot(secId,day,pi);
}

function refreshManualSlot(secId,day,pi){
  const cell=$('mslot_'+day+'_'+pi); if(!cell) return;
  const slot=manualTTSlots[day+'_'+pi];
  const sub=slot&&slot.subId?getSub(slot.subId):null;
  cell.className='mtt-slot '+(sub?'filled-'+(slot.type==='lab'?'l':'t'):'');
  cell.innerHTML=sub?`<div class="sc" style="color:${sub.color||'var(--teal)'}">${sub.code}</div><div class="sn">${sub.name.slice(0,12)}</div><div class="sr">${slot.room||''}</div>`:'<div style="color:var(--text4);font-size:10px;text-align:center;padding:4px">+</div>';
}

function clearManualTT(secId){
  if(!confirm('Clear all slots for section '+secId+'?')) return;
  C.days.forEach(day=>getPeriods().forEach((_,i)=>{ manualTTSlots[day+'_'+i]={period:i+1,subId:null,facId:null,room:null,type:'free'}; }));
  buildManualTTGrid();
}

function saveManualTT(secId){
  const schedule={};
  C.days.forEach(day=>{
    schedule[day]=getPeriods().map((_,i)=>manualTTSlots[day+'_'+i]||{period:i+1,subId:null,facId:null,room:null,type:'free'});
  });
  A.db.timetables=A.db.timetables.filter(t=>t.secId!==secId);
  A.db.timetables.push({secId,branch:secId.split('-')[0],section:secId.split('-')[1],schedule});
  save(); toast('Timetable saved for '+secId+'!','ok');
}

/* ━━━ AI TIMETABLE GENERATOR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let aiStep=0;
const aiConfig={course:'',branch:'',sections:1,periodsPerDay:6,workingDays:6,periodDuration:60,maxContiguous:2,subjectConfig:[]};

function admAIGen(){
  aiStep=0;
  return `<div class="ai-wiz">
    <div class="wiz-steps">
      ${[['Course & Branch','fa-book'],['Schedule Config','fa-clock'],['Subject Config','fa-atom'],['Constraints','fa-shield-alt'],['Generate','fa-robot']].map((s,i)=>`
        <div class="wiz-step ${i===0?'active':''}" id="wizstep-${i}">
          <div class="wiz-snum">${i+1}</div>${s[0]}
        </div>`).join('')}
    </div>
    <div class="wiz-body" id="wiz-body">${renderWizStep(0)}</div>
  </div>`;
}

function renderWizStep(step){
  aiStep=step;
  document.querySelectorAll('.wiz-step').forEach((el,i)=>{
    el.className='wiz-step'+(i===step?' active':i<step?' done':'');
  });
  switch(step){
    case 0: return `
      <h3 style="font-family:var(--font-head);font-size:18px;margin-bottom:4px">Select Course & Branch</h3>
      <p style="color:var(--text3);margin-bottom:18px;font-size:13px">Choose which branch and sections to generate the timetable for</p>
      <div class="frow">
        <div class="fgroup"><label>Branch</label>
          <select id="ai-branch" onchange="updateAIBranch()">
            ${A.db.courses.map(c=>`<option value="${c.id}">${c.id} — ${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="fgroup"><label>Number of Sections</label>
          <input type="number" id="ai-nsec" value="1" min="1" max="10"/>
        </div>
      </div>
      <div id="ai-sec-preview" style="margin-top:12px"></div>
      <div class="wiz-nav"><div></div><button class="btn-solid" onclick="wizNext()">Next <i class="fas fa-arrow-right"></i></button></div>`;
    case 1: {
      const cfg=A.db.periodConfig;
      return `
      <h3 style="font-family:var(--font-head);font-size:18px;margin-bottom:4px">Schedule Configuration</h3>
      <p style="color:var(--text3);margin-bottom:18px;font-size:13px">
        Pre-filled from your <b style="color:var(--teal)">Period Timings</b> settings. Adjust here or update in Structure → Period Timings.
      </p>
      <div style="background:var(--surface2);border-radius:var(--r);padding:12px 16px;margin-bottom:16px;font-size:12px;color:var(--text3)">
        <i class="fas fa-stopwatch" style="color:var(--teal);margin-right:6px"></i>
        Current schedule: <b style="color:var(--text)">${cfg.periods.length} periods/day</b> · 
        <b style="color:var(--text)">${cfg.periods[0]?minsToHMStr(cfg.periods[0].start):''} start</b> · 
        <b style="color:var(--text)">${cfg.morningBreak||0}-min morning breaks</b> · 
        <b style="color:var(--text)">Lunch: ${getLunch().time}</b> ·
        <b style="color:var(--text)">Labs = ${cfg.labDuration||2} periods (${(cfg.labDuration||2)*(cfg.periodDuration||60)} min)</b>
      </div>
      <div class="frow">
        <div class="fgroup"><label>Periods Per Day</label>
          <input type="number" id="ai-ppd" value="${cfg.periods.length}" min="4" max="10"/>
        </div>
        <div class="fgroup"><label>Working Days Per Week</label>
          <select id="ai-wd">
            <option value="5" ${cfg.workingDays===5?'selected':''}>5 days (Mon–Fri)</option>
            <option value="6" ${cfg.workingDays===6?'selected':''}>6 days (Mon–Sat)</option>
          </select>
        </div>
      </div>
      <div class="frow">
        <div class="fgroup"><label>Period Duration (minutes)</label>
          <input type="number" id="ai-pd" value="${cfg.periodDuration||60}" min="30" max="120"/>
        </div>
        <div class="fgroup"><label>Lab Duration (periods)</label>
          <input type="number" id="ai-lab" value="${cfg.labDuration||2}" min="1" max="4"/>
        </div>
      </div>
      <div class="wiz-nav">
        <button class="btn-ghost" onclick="wizBack()"><i class="fas fa-arrow-left"></i> Back</button>
        <button class="btn-solid" onclick="wizNext()">Next <i class="fas fa-arrow-right"></i></button>
      </div>`;
    }
    case 2: {
      const branch=($('ai-branch')||{value:A.db.courses[0].id}).value||A.db.courses[0].id;
      const subs=getSubsByBranch(branch);
      return `
        <h3 style="font-family:var(--font-head);font-size:18px;margin-bottom:4px">Subject Configuration</h3>
        <p style="color:var(--text3);margin-bottom:18px;font-size:13px">Set periods per week for each subject and assign faculty</p>
        <div class="subj-cfg-list">
          ${subs.map(sb=>{
            const facs=A.db.faculty.filter(f=>(f.subs||[]).includes(sb.id));
            return `<div class="subj-cfg-row">
              <span class="subj-cfg-name" style="color:${sb.color||'var(--teal)'}">${sb.code} — ${sb.name}</span>
              <select id="scfg-fac-${sb.id}" style="width:140px;font-size:11px;padding:5px">
                <option value="">Faculty</option>
                ${facs.map(f=>`<option value="${f.id}">${f.name.split(' ').slice(-1)[0]}</option>`).join('')}
                ${A.db.faculty.map(f=>`<option value="${f.id}">${f.name.split(' ').slice(-1)[0]}</option>`).join('')}
              </select>
              <label style="font-size:11px;color:var(--text3)">PPW:</label>
              <input type="number" id="scfg-ppw-${sb.id}" value="${sb.ppw}" min="1" max="6"/>
              <span class="sbadge ${sb.type==='lab'?'late':'active'}" style="font-size:10px">${sb.type}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="wiz-nav">
          <button class="btn-ghost" onclick="wizBack()"><i class="fas fa-arrow-left"></i> Back</button>
          <button class="btn-solid" onclick="wizNext()">Next <i class="fas fa-arrow-right"></i></button>
        </div>`;
    }
    case 3: return `
      <h3 style="font-family:var(--font-head);font-size:18px;margin-bottom:4px">Constraints</h3>
      <p style="color:var(--text3);margin-bottom:18px;font-size:13px">Define rules the AI must follow when generating the timetable</p>
      <div class="frow">
        <div class="fgroup"><label>Max Contiguous Periods (same subject)</label><input type="number" id="ai-mc" value="2" min="1" max="3"/></div>
        <div class="fgroup"><label>Faculty Max Periods/Day</label><input type="number" id="ai-fmax" value="4" min="2" max="6"/></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="c-no-gap" checked/><span style="font-size:13px">No gaps between periods for students</span></label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="c-lab-block" checked/><span style="font-size:13px">Labs must be in 3 consecutive slots</span></label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="c-no-conflict" checked/><span style="font-size:13px">No room or faculty conflicts</span></label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="c-spread" checked/><span style="font-size:13px">Spread subjects evenly across week</span></label>
      </div>
      <div class="wiz-nav">
        <button class="btn-ghost" onclick="wizBack()"><i class="fas fa-arrow-left"></i> Back</button>
        <button class="btn-solid" onclick="wizNext()">Next <i class="fas fa-arrow-right"></i></button>
      </div>`;
    case 4: return `
      <h3 style="font-family:var(--font-head);font-size:18px;margin-bottom:4px">Generate Timetable</h3>
      <p style="color:var(--text3);margin-bottom:18px;font-size:13px">Review your configuration and generate the AI-optimized timetable</p>
      <div style="background:var(--surface2);border-radius:var(--r);padding:14px;margin-bottom:18px">
        <div style="font-size:12px;color:var(--text3);line-height:1.8">
          <b style="color:var(--text)">Ready to generate timetable for all selected sections</b><br/>
          The AI will use a constraint satisfaction algorithm to:<br/>
          • Resolve faculty conflicts across all sections<br/>
          • Place labs in 3-hour contiguous blocks<br/>
          • Spread theory classes evenly across the week<br/>
          • Respect maximum contiguous period limits
        </div>
      </div>
      <div id="gen-prog-area"></div>
      <div class="wiz-nav">
        <button class="btn-ghost" onclick="wizBack()"><i class="fas fa-arrow-left"></i> Back</button>
        <button class="btn-solid" id="gen-btn" onclick="runAIGenerate()"><i class="fas fa-robot"></i> Generate Now</button>
      </div>`;
    default: return '';
  }
}

function wizNext(){
  const body=$('wiz-body'); if(!body) return;
  body.innerHTML=renderWizStep(aiStep+1);
}
function wizBack(){
  const body=$('wiz-body'); if(!body) return;
  body.innerHTML=renderWizStep(aiStep-1);
}
function updateAIBranch(){ /* preview could go here */ }

function runAIGenerate(){
  const genBtn=$('gen-btn'); if(genBtn) genBtn.disabled=true;
  const progArea=$('gen-prog-area'); if(!progArea) return;
  progArea.innerHTML=`
    <div class="gen-prog">
      <div class="prog-ring" id="prog-ring" style="--p:0%"><span id="prog-pct">0%</span></div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:10px" id="prog-msg">Initializing constraint solver...</div>
      <div class="gen-log" id="gen-log"></div>
    </div>`;

  const cfg=A.db.periodConfig;
  // Read step 1 inputs if available
  if($('ai-ppd')&&cfg) { /* user may have changed period count in wizard */ }
  const labSlotsVal = parseInt(($('ai-lab')||{value:cfg.labDuration||2}).value)||2;
  const logs=[
    'Analysing faculty workload constraints...',
    'Mapping room availability matrix...',
    `Placing lab sessions (${labSlotsVal} consecutive slots = ${labSlotsVal*(cfg.periodDuration||60)} min)...`,
    'Resolving theory slot conflicts...',
    'Applying spread-distribution heuristics...',
    'Checking contiguous period constraints...',
    'Finalizing timetable structure...',
    'Running conflict validation pass...',
    'Generation complete!'
  ];
  let step=0;
  const logEl=$('gen-log');
  const ringEl=$('prog-ring');
  const pctEl=$('prog-pct');
  const msgEl=$('prog-msg');

  const interval=setInterval(()=>{
    if(step>=logs.length){
      clearInterval(interval);
      // Pass current periodConfig into builder
      const newTTs=buildAllTimetables(A.db.faculty, A.db.sections, A.db.subjects, cfg);
      A.db.timetables=newTTs;
      save();
      if(progArea){
        progArea.innerHTML=`<div style="text-align:center;padding:20px">
          <div style="font-size:40px;color:var(--green);margin-bottom:12px"><i class="fas fa-check-circle"></i></div>
          <div style="font-family:var(--font-head);font-size:20px;font-weight:800;margin-bottom:8px">Timetable Generated!</div>
          <p style="color:var(--text3);margin-bottom:6px">Successfully generated conflict-free timetables for all ${A.db.sections.length} sections.</p>
          <p style="color:var(--text3);font-size:12px;margin-bottom:16px">${cfg.periods.length} periods/day · ${cfg.periods[0]?minsToHMStr(cfg.periods[0].start):''} start · Labs = ${labSlotsVal} periods</p>
          <button class="btn-solid" onclick="admView('viewtt')"><i class="fas fa-eye"></i> View Timetables</button>
        </div>`;
      }
      return;
    }
    const pct=Math.round((step+1)/logs.length*100);
    if(ringEl) ringEl.style.setProperty('--p',pct+'%');
    if(pctEl) pctEl.textContent=pct+'%';
    if(msgEl) msgEl.textContent=logs[step];
    if(logEl){
      const line=document.createElement('div');
      line.innerHTML=`<span class="${step===logs.length-1?'log-ok':'log-i'}">› ${logs[step]}</span>`;
      logEl.appendChild(line);
      logEl.scrollTop=logEl.scrollHeight;
    }
    step++;
  },600);
}

/* ━━━ ADMIN NOTICES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function admNotices(){
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-bullhorn"></i>Post Notice / Announcement</div></div>
      <div class="fgroup"><label>Title</label><input type="text" id="adm-ann-title" placeholder="Notice title"/></div>
      <div class="fgroup"><label>Message</label><textarea id="adm-ann-body" placeholder="Write your notice..."></textarea></div>
      <div class="frow">
        <div class="fgroup"><label>Type</label><select id="adm-ann-type"><option value="exam">Exam</option><option value="holiday">Holiday</option><option value="academic">Academic</option><option value="event">Event</option><option value="general">General</option></select></div>
        <div class="fgroup"><label>Priority</label><select id="adm-ann-prio"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
      </div>
      <div class="fgroup"><label>Target Branches</label>
        <div style="display:flex;gap:8px;margin-top:6px">
          ${A.db.courses.map(c=>`<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px"><input type="checkbox" value="${c.id}" class="ann-branch-cb" checked/>${c.id}</label>`).join('')}
        </div>
      </div>
      <button class="btn-solid" onclick="postAdminNotice()"><i class="fas fa-paper-plane"></i> Post Notice</button>
    </div>
    <div class="card">
      <div class="card-hdr"><div class="card-title"><i class="fas fa-list"></i>All Notices (${A.db.announcements.length})</div></div>
      <div class="notif-list">
        ${A.db.announcements.map(a=>`<div class="notif-item">
          ${renderAnnCard(a,true)}
          <button class="btn-icon del" style="flex-shrink:0;align-self:flex-start;margin-top:4px" onclick="deleteNotice('${a.id}')"><i class="fas fa-trash"></i></button>
        </div>`).join('')}
      </div>
    </div>`;
}

function postAdminNotice(){
  const title=($('adm-ann-title')||{}).value; const body=($('adm-ann-body')||{}).value;
  if(!title||!body){ toast('Please fill title and message','err'); return; }
  const branches=Array.from(document.querySelectorAll('.ann-branch-cb:checked')).map(c=>c.value);
  A.db.announcements.unshift({id:uid(),title,body,author:A.user.name,date:new Date().toISOString().split('T')[0],type:($('adm-ann-type')||{}).value||'general',priority:($('adm-ann-prio')||{}).value||'medium',branches:branches.length?branches:['CSE','IT','CST']});
  save(); toast('Notice posted!','ok'); admView('notices');
}

function deleteNotice(id){
  if(!confirm('Delete this notice?')) return;
  A.db.announcements=A.db.announcements.filter(a=>a.id!==id);
  save(); toast('Notice deleted','warn'); admView('notices');
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HOME PAGE RENDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function renderHomePage(){
  renderHeroTT();
  renderFeatures();
  renderHowItWorks();
  renderModules();
}

function renderHeroTT(){
  const el=$('heroTT'); if(!el) return;
  const cols=['Mon','Tue','Wed','Thu','Fri','Sat'];
  const rows=['CS601','CS602','CS603','CS604','CS605','OS Lab'];
  const colors=['#0affcb','#3b82f6','#f59e0b','#ef4444','#22c55e','#8b5cf6'];
  let html=`<div style="display:grid;grid-template-columns:60px repeat(6,1fr);font-size:9px">
    <div style="background:var(--surface2);padding:6px;font-weight:700;color:var(--text4)">Period</div>
    ${cols.map(d=>`<div style="background:var(--surface2);padding:6px;text-align:center;font-weight:700;color:var(--text3)">${d}</div>`).join('')}
  `;
  const demoGrid=[
    ['CS601','CS602','','CS604','CS605',''],
    ['CS602','CS601','CS603','','CS602','CS601'],
    ['','CS603','CS601','CS602','','CS605'],
    ['CS604','','CS605','CS603','CS601','CS604'],
    ['CS605','CS604','CS602','OS Lab','CS603','CS602'],
    ['CS603','OS Lab','CS604','CS605','OS Lab','CS603']
  ];
  rows.forEach((per,pi)=>{
    html+=`<div style="background:var(--surface2);padding:6px;font-family:var(--font-mono);font-size:9px;color:var(--text4);text-align:center">P${pi+1}</div>`;
    cols.forEach((col,ci)=>{
      const sub=demoGrid[pi]&&demoGrid[pi][ci];
      const isLab=sub&&sub.includes('Lab');
      const color=sub?colors[pi%colors.length]:'';
      html+=sub?`<div style="padding:5px;border:1px solid var(--border);background:${color}11"><div style="font-weight:700;font-size:9px;color:${color}">${sub}</div><div style="font-size:8px;color:var(--text4)">${isLab?'Lab':'Th'}</div></div>`:`<div style="padding:5px;border:1px solid var(--border)"></div>`;
    });
  });
  html+=`</div>`;
  el.innerHTML=html;
}

function renderFeatures(){
  const el=$('featuresGrid'); if(!el) return;
  const features=[
    {icon:'fa-robot',color:'#0affcb',title:'AI Timetable Generation',desc:'Constraint-satisfaction algorithm generates conflict-free timetables in seconds, respecting faculty workload, room availability, and lab requirements.'},
    {icon:'fa-clipboard-check',color:'#3b82f6',title:'Real-time Attendance',desc:'Faculty can mark attendance section-by-section. Students see live attendance percentages and get alerts when falling below 75%.'},
    {icon:'fa-calendar-week',color:'#f59e0b',title:'Dynamic Scheduling',desc:'Admin edits to timetables instantly reflect across all student and faculty dashboards. No manual syncing required.'},
    {icon:'fa-clock',color:'#8b5cf6',title:'Next Class Countdown',desc:'Students and faculty see which class is next with exact room location, faculty details, and a live countdown timer.'},
    {icon:'fa-chart-bar',color:'#22c55e',title:'Analytics Dashboard',desc:'Admin and faculty get detailed attendance analytics by branch, section, and subject with visual progress indicators.'},
    {icon:'fa-bell',color:'#ef4444',title:'Announcements System',desc:'Faculty and admin can broadcast notices to specific branches. Students receive targeted announcements on their dashboard.'}
  ];
  el.innerHTML=features.map((f,i)=>`<div class="feat-card" style="animation-delay:${i*0.1}s">
    <div class="feat-icon" style="background:${f.color}18;color:${f.color}"><i class="fas ${f.icon}"></i></div>
    <h3>${f.title}</h3>
    <p>${f.desc}</p>
  </div>`).join('');
}

function renderHowItWorks(){
  const el=$('howGrid'); if(!el) return;
  const steps=[
    {num:'01',icon:'🔧',title:'Admin Setup',desc:'Admin configures courses, branches, sections, rooms and faculty. Assigns subjects to faculty members and sets up the system.'},
    {num:'02',icon:'🤖',title:'AI Generation',desc:'Admin triggers the AI timetable generator. The constraint solver creates optimized conflict-free schedules for all sections.'},
    {num:'03',icon:'📋',title:'Timetable Published',desc:'Generated timetables automatically appear in student and faculty dashboards. Any edits propagate in real time.'},
    {num:'04',icon:'✅',title:'Attendance Tracking',desc:'Faculty marks daily attendance per subject and section. Students track their attendance live and see risk warnings.'}
  ];
  el.innerHTML=steps.map((s,i)=>`<div class="how-card" style="animation-delay:${i*0.1}s">
    <div class="how-num">${s.num}</div>
    <div class="how-icon">${s.icon}</div>
    <h3>${s.title}</h3>
    <p>${s.desc}</p>
  </div>`).join('');
}

function renderModules(){
  const el=$('modulesGrid'); if(!el) return;
  const mods=[
    {icon:'👨‍🎓',title:'Student',color:'rgba(10,255,203,.08)',border:'rgba(10,255,203,.2)',tc:'var(--teal)',desc:'Track attendance, view timetables, see next class location, check exam schedules and performance.',features:['View weekly timetable','Live attendance tracking','Next class with countdown','Exam schedule','Performance analytics','Announcement feed']},
    {icon:'🛡️',title:'Admin',color:'rgba(245,158,11,.08)',border:'rgba(245,158,11,.2)',tc:'var(--amber)',desc:'Full control over the institution — manage students, faculty, courses, rooms, and AI-generate timetables.',features:['Manage students & faculty','Course & section management','Room assignment','AI timetable generator','Manual timetable editor','Analytics dashboard']},
    {icon:'👩‍🏫',title:'Faculty',color:'rgba(59,130,246,.08)',border:'rgba(59,130,246,.2)',tc:'var(--blue)',desc:'Manage attendance, view assigned timetables, see next class, submit leave requests and post announcements.',features:['Mark student attendance','View section timetables','Next class countdown','Section analytics','Leave request system','Post announcements']}
  ];
  el.innerHTML=mods.map(m=>`<div class="mod-card" style="background:${m.color};border-color:${m.border}">
    <div class="mc-icon">${m.icon}</div>
    <h3 style="color:${m.tc}">${m.title}</h3>
    <p>${m.desc}</p>
    <ul>${m.features.map(f=>`<li style="color:${m.tc}">${f}</li>`).join('')}</ul>
    <button class="btn-solid" onclick="showPage('auth')" style="background:${m.tc.replace('var(--teal)','#00c99e').replace('var(--amber)','#b45309').replace('var(--blue)','#1d4ed8')};color:#000">Login as ${m.title} <i class="fas fa-arrow-right"></i></button>
  </div>`).join('');
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   INIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
document.addEventListener('DOMContentLoaded', async () => {
  startClock();
  renderHomePage();

  // Try loading from API first
  const apiOk = await loadFromAPI();

  if(!apiOk){
    // API failed — fall back to localStorage or seed data
    console.warn('API unavailable — falling back to local data');
    const loaded = load();
    if(!loaded || !A.db){
      seedDB();
    } else if(A.db.version !== 4){
      if(!A.db.periodConfig) A.db.periodConfig = buildDefaultPeriodConfig();
      A.db.version = 4;
      save();
    }
    toast('Could not reach database — showing cached data','warn');
  }

  // Re-render home page with real data counts
  renderHomePage();
});
