(function(root){
  'use strict';
  const STATUSES=['未开始','进行中','已完成','延期'];
  const PRIORITIES={'urgent-important':'紧急且重要',important:'重要',normal:'普通',low:'低优先级'};
  const day=v=>typeof v==='string'?v.slice(0,10):'';
  const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'') && !isNaN(Date.parse(v)) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const uid=()=>root.crypto?.randomUUID?.()||'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  function normalize(t){
    if(!t||typeof t!=='object')throw Error('任务格式不正确');
    const status=STATUSES.includes(t.status)?t.status:'未开始';
    return {...t,id:String(t.id??uid()),projectId:String(t.projectId||'user-'+(t.projectName||'日常办公任务')),projectName:String(t.projectName||'日常办公任务'),phaseName:String(t.phaseName||'常规跟进事项'),phaseOwner:String(t.phaseOwner||t.owner||'未填写'),name:String(t.name||t.taskName||'未命名任务'),owner:String(t.owner||'未填写'),priority:PRIORITIES[t.priority]?t.priority:'normal',status,progress:status==='已完成'?100:Math.min(99,Math.max(0,Number(t.progress)||0)),deadline:day(t.deadline),originalDeadline:day(t.originalDeadline||t.deadline),startDate:day(t.startDate),createdAt:day(t.createdAt),completedAt:status==='已完成'?day(t.completedAt)||null:null,note:String(t.note||''),outcome:String(t.outcome||''),dependencies:Array.isArray(t.dependencies)?t.dependencies.map(String):[],blocked:t.blocked===true};
  }
  function snapshot(tasks,date,isDemo){
    if(!isDemo)return tasks.filter(t=>!t.deleted).map(normalize);
    return tasks.flatMap(task=>{
      if(!Array.isArray(task.history))return !task.deleted&&(!task.createdAt||day(task.createdAt)<=date)?[normalize(task)]:[];
      const events=task.history.map((e,i)=>({...e,order:i})).filter(e=>e.date<=date).sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order);
      const last=events.at(-1);return last && !last.snapshot.deleted?[{...normalize(last.snapshot),history:task.history}]:[];
    });
  }
  function riskTags(t,date){
    if(t.status==='已完成')return [];
    const tags=[];const delta=t.deadline?(Date.parse(t.deadline)-Date.parse(date))/86400000:null;
    if(t.status==='延期')tags.push('明确延期');
    if(delta!==null&&delta<0)tags.push('已逾期');
    if(delta!==null&&delta>=0&&delta<=3)tags.push('临近截止');
    if(t.priority==='urgent-important')tags.push('高优先级待处理');
    if(t.blocked)tags.push('阻塞事项');
    return tags;
  }
  function visibleRisks(records,date){return records.flatMap(r=>{const h=r.history.filter(e=>e.date<=date).sort((a,b)=>a.date.localeCompare(b.date));return h.length?[{...r,...h.at(-1),history:h}]:[];});}
  function metrics(tasks,date,records=[]){
    const counts=Object.fromEntries(STATUSES.map(s=>[s,tasks.filter(t=>t.status===s).length]));
    const risky=new Set(tasks.filter(t=>riskTags(t,date).length).map(t=>t.id));
    records.filter(r=>r.status!=='已关闭'&&tasks.some(t=>t.id===r.taskId)).forEach(r=>risky.add(r.taskId));
    const completed=tasks.filter(t=>t.status==='已完成');
    const dated=completed.filter(t=>validDate(t.completedAt)&&validDate(t.originalDeadline));
    const ontime=dated.filter(t=>t.completedAt<=t.originalDeadline).length;
    return {total:tasks.length,completed:counts['已完成'],rate:tasks.length?Math.round(counts['已完成']/tasks.length*100):0,counts,risk:risky.size,riskIds:[...risky],overdue:tasks.filter(t=>riskTags(t,date).includes('已逾期')).length,delayed:counts['延期'],dueSoon:tasks.filter(t=>riskTags(t,date).includes('临近截止')).length,openRisks:records.filter(r=>r.status!=='已关闭'&&tasks.some(t=>t.id===r.taskId)).length,ontime,late:dated.length-ontime,unknown:completed.length-dated.length};
  }
  function projectList(dataset,tasks,isDemo){
    const result=isDemo?dataset.projects.map(p=>({...p})):[];
    tasks.forEach(t=>{if(!result.some(p=>p.id===t.projectId))result.push({id:t.projectId,name:t.projectName,short:t.projectName,owner:t.phaseOwner||t.owner,color:'#4e73e8',icon:'folder',category:'项目',description:'整理重点业务项目，记录关键事项与推进过程。',goal:'按计划完成项目任务，记录执行过程与成果。',phases:[],milestones:[]});});
    return result.map(p=>{const items=tasks.filter(t=>t.projectId===p.id);const completed=items.filter(t=>t.status==='已完成').length;return {...p,tasks:items,total:items.length,completed,rate:items.length?Math.round(completed/items.length*100):0,phases:[...new Set([...(p.phases||[]),...items.map(t=>t.phaseName)])],start:p.start||items.map(t=>t.startDate).filter(Boolean).sort()[0]||'',end:p.end||items.map(t=>t.deadline).filter(Boolean).sort().at(-1)||''};});
  }
  function milestones(p,date){return (p.milestones||[]).map((r,i)=>{const tasks=p.tasks.filter(t=>r[2].map(n=>typeof n==='number'?p.id+'-'+n:n).includes(t.id));const required=r[2].length,done=tasks.filter(t=>t.status==='已完成').length;return {id:p.id+'-m'+(i+1),name:r[0],date:r[1],tasks,required,done,rate:Math.round(done/required*100),status:done===required?'已完成':r[1]<date?'已延误':'待交付'};});}
  function monthly(tasks,date,range){
    const months=range||[...new Set(tasks.flatMap(t=>[t.createdAt?.slice(0,7),t.completedAt?.slice(0,7)]).filter(Boolean))].sort();
    return months.map(month=>{
      const end=month+'-31',until=end<date?end:date;
      const cumulative=tasks.filter(t=>t.status==='已完成'&&validDate(t.completedAt)&&t.completedAt<=until).length;
      const total=tasks.filter(t=>validDate(t.createdAt)&&t.createdAt<=until).length;
      return {month,created:tasks.filter(t=>t.createdAt?.startsWith(month)&&t.createdAt<=date).length,completed:tasks.filter(t=>t.status==='已完成'&&t.completedAt?.startsWith(month)&&t.completedAt<=date).length,cumulative,cumulativeRate:total?Math.round(cumulative/total*100):0};
    });
  }
  function updateHistory(task,changes,date,type='任务更新'){
    const current=snapshot([task],date,true)[0];if(!current)throw Error('此日期尚无该任务');
    const next=normalize({...current,...changes});delete next.history;
    return {...task,...next,history:[...task.history,{date,type,snapshot:next}]};
  }
  function parseCSV(text){
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
    if(quoted)throw Error('CSV 引号未闭合');row.push(cell);if(row.some(Boolean))rows.push(row);if(rows.length<2)throw Error('CSV 没有任务');
    const head=rows.shift().map(h=>h.replace(/^\uFEFF/,''));
    return rows.map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]||''])));
  }
  function csv(tasks){const keys=['id','projectId','projectName','phaseName','phaseOwner','name','owner','priority','createdAt','startDate','deadline','originalDeadline','completedAt','status','progress','note','outcome','plannedOutcome','goal','work','scenario','handover','dependencies','blocked'];const safe=v=>{const s=String(v??'');return /^[=+@\-\t\r]/.test(s)?"'"+s:s;};return '\uFEFF'+[keys,...tasks.map(t=>keys.map(k=>['dependencies','handover'].includes(k)?JSON.stringify(t[k]):k==='blocked'?String(!!t[k]):t[k]))].map(r=>r.map(v=>'"'+safe(v).replaceAll('"','""')+'"').join(',')).join('\r\n');}
  function updateTask(task,changes,date,type='任务更新'){
    if(!task.history)return normalize({...task,...changes});
    const next=updateHistory(task,changes,date,type),latest=[...next.history].map((e,i)=>({...e,order:i})).sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order).at(-1);
    return {...next,...normalize(latest.snapshot),history:next.history};
  }
  root.BoardCore={STATUSES,PRIORITIES,day,validDate,today,uid,normalize,snapshot,riskTags,visibleRisks,metrics,projectList,milestones,monthly,updateHistory,updateTask,parseCSV,csv};
})(typeof window!=='undefined'?window:globalThis);
