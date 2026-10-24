/* Public experience storage. Never enumerate or migrate other applications' data. */
(function(root){
'use strict';
const C=root.BoardCore;
const KEYS={unified:'projectDashboardPublicDemo:v1:workspace'};
const empty=()=>({version:4,projects:[],tasks:[],risks:[]});
  function validate(ds){
    if(!ds||!Array.isArray(ds.projects)||!Array.isArray(ds.tasks)||!Array.isArray(ds.risks))throw Error('项目存储结构无效');
    for(const list of [ds.projects,ds.tasks,ds.risks]){
      if(list.some(x=>!x||x.id==null)||new Set(list.map(x=>String(x.id))).size!==list.length)throw Error('存储含重复或无效 ID');
    }
    const validateTask=t=>{
      C.normalize(t);
      if(typeof (t.name||t.taskName)!=='string')throw Error('任务名称无效');
      if(t.dependencies&&!Array.isArray(t.dependencies))throw Error('任务依赖无效');
      if(t.history&&(!Array.isArray(t.history)||!t.history.length||t.history.some(e=>!C.validDate(e.date)||!e.snapshot)))throw Error('任务历史无效');
      if(t.history)t.history.forEach(e=>validateTask({...e.snapshot,history:undefined}));
    };
    ds.tasks.forEach(validateTask);
    ds.projects.forEach(p=>{if(typeof p.name!=='string'||p.phases&&!Array.isArray(p.phases)||p.milestones&&(!Array.isArray(p.milestones)||p.milestones.some(m=>!Array.isArray(m)||!Array.isArray(m[2])||!m[2].length)))throw Error('项目元数据无效');});
    ds.risks.forEach(r=>{if(!r.taskId||!Array.isArray(r.history)||r.history.some(e=>!C.validDate(e.date)||!['待处理','处理中','已关闭'].includes(e.status)))throw Error('风险历史无效');});
    return ds;
  }

function load(){const corrupt=new Set();try{const raw=root.localStorage.getItem(KEYS.unified);if(raw===null)return {data:empty(),corrupt,blocked:false};const data=validate(JSON.parse(raw));if(data.version!==4)throw Error('不支持的版本');return {data,corrupt,blocked:false};}catch(e){corrupt.add(KEYS.unified);return {data:empty(),corrupt,blocked:true};}}
root.BoardStorage={KEYS,load,validate,empty};
})(typeof window!=='undefined'?window:globalThis);
