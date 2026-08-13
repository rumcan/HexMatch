(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))a(o);new MutationObserver(o=>{for(const l of o)if(l.type==="childList")for(const u of l.addedNodes)u.tagName==="LINK"&&u.rel==="modulepreload"&&a(u)}).observe(document,{childList:!0,subtree:!0});function e(o){const l={};return o.integrity&&(l.integrity=o.integrity),o.referrerPolicy&&(l.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?l.credentials="include":o.crossOrigin==="anonymous"?l.credentials="omit":l.credentials="same-origin",l}function a(o){if(o.ep)return;o.ep=!0;const l=e(o);fetch(o.href,l)}})();var Cd={exports:{}},Bl={};var W_;function Bb(){if(W_)return Bl;W_=1;var s=Symbol.for("react.transitional.element"),t=Symbol.for("react.fragment");function e(a,o,l){var u=null;if(l!==void 0&&(u=""+l),o.key!==void 0&&(u=""+o.key),"key"in o){l={};for(var h in o)h!=="key"&&(l[h]=o[h])}else l=o;return o=l.ref,{$$typeof:s,type:a,key:u,ref:o!==void 0?o:null,props:l}}return Bl.Fragment=t,Bl.jsx=e,Bl.jsxs=e,Bl}var q_;function Ib(){return q_||(q_=1,Cd.exports=Bb()),Cd.exports}var Ry=Ib(),Dd={exports:{}},Il={},Ud={exports:{}},Ld={};var Y_;function zb(){return Y_||(Y_=1,(function(s){function t(F,N){var V=F.length;F.push(N);t:for(;0<V;){var nt=V-1>>>1,mt=F[nt];if(0<o(mt,N))F[nt]=N,F[V]=mt,V=nt;else break t}}function e(F){return F.length===0?null:F[0]}function a(F){if(F.length===0)return null;var N=F[0],V=F.pop();if(V!==N){F[0]=V;t:for(var nt=0,mt=F.length,L=mt>>>1;nt<L;){var X=2*(nt+1)-1,_t=F[X],Ct=X+1,Lt=F[Ct];if(0>o(_t,V))Ct<mt&&0>o(Lt,_t)?(F[nt]=Lt,F[Ct]=V,nt=Ct):(F[nt]=_t,F[X]=V,nt=X);else if(Ct<mt&&0>o(Lt,V))F[nt]=Lt,F[Ct]=V,nt=Ct;else break t}}return N}function o(F,N){var V=F.sortIndex-N.sortIndex;return V!==0?V:F.id-N.id}if(s.unstable_now=void 0,typeof performance=="object"&&typeof performance.now=="function"){var l=performance;s.unstable_now=function(){return l.now()}}else{var u=Date,h=u.now();s.unstable_now=function(){return u.now()-h}}var d=[],p=[],g=1,_=null,v=3,x=!1,b=!1,C=!1,M=!1,y=typeof setTimeout=="function"?setTimeout:null,I=typeof clearTimeout=="function"?clearTimeout:null,D=typeof setImmediate<"u"?setImmediate:null;function A(F){for(var N=e(p);N!==null;){if(N.callback===null)a(p);else if(N.startTime<=F)a(p),N.sortIndex=N.expirationTime,t(d,N);else break;N=e(p)}}function O(F){if(C=!1,A(F),!b)if(e(d)!==null)b=!0,U||(U=!0,K());else{var N=e(p);N!==null&&J(O,N.startTime-F)}}var U=!1,z=-1,T=5,P=-1;function k(){return M?!0:!(s.unstable_now()-P<T)}function H(){if(M=!1,U){var F=s.unstable_now();P=F;var N=!0;try{t:{b=!1,C&&(C=!1,I(z),z=-1),x=!0;var V=v;try{e:{for(A(F),_=e(d);_!==null&&!(_.expirationTime>F&&k());){var nt=_.callback;if(typeof nt=="function"){_.callback=null,v=_.priorityLevel;var mt=nt(_.expirationTime<=F);if(F=s.unstable_now(),typeof mt=="function"){_.callback=mt,A(F),N=!0;break e}_===e(d)&&a(d),A(F)}else a(d);_=e(d)}if(_!==null)N=!0;else{var L=e(p);L!==null&&J(O,L.startTime-F),N=!1}}break t}finally{_=null,v=V,x=!1}N=void 0}}finally{N?K():U=!1}}}var K;if(typeof D=="function")K=function(){D(H)};else if(typeof MessageChannel<"u"){var ft=new MessageChannel,dt=ft.port2;ft.port1.onmessage=H,K=function(){dt.postMessage(null)}}else K=function(){y(H,0)};function J(F,N){z=y(function(){F(s.unstable_now())},N)}s.unstable_IdlePriority=5,s.unstable_ImmediatePriority=1,s.unstable_LowPriority=4,s.unstable_NormalPriority=3,s.unstable_Profiling=null,s.unstable_UserBlockingPriority=2,s.unstable_cancelCallback=function(F){F.callback=null},s.unstable_forceFrameRate=function(F){0>F||125<F?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):T=0<F?Math.floor(1e3/F):5},s.unstable_getCurrentPriorityLevel=function(){return v},s.unstable_next=function(F){switch(v){case 1:case 2:case 3:var N=3;break;default:N=v}var V=v;v=N;try{return F()}finally{v=V}},s.unstable_requestPaint=function(){M=!0},s.unstable_runWithPriority=function(F,N){switch(F){case 1:case 2:case 3:case 4:case 5:break;default:F=3}var V=v;v=F;try{return N()}finally{v=V}},s.unstable_scheduleCallback=function(F,N,V){var nt=s.unstable_now();switch(typeof V=="object"&&V!==null?(V=V.delay,V=typeof V=="number"&&0<V?nt+V:nt):V=nt,F){case 1:var mt=-1;break;case 2:mt=250;break;case 5:mt=1073741823;break;case 4:mt=1e4;break;default:mt=5e3}return mt=V+mt,F={id:g++,callback:N,priorityLevel:F,startTime:V,expirationTime:mt,sortIndex:-1},V>nt?(F.sortIndex=V,t(p,F),e(d)===null&&F===e(p)&&(C?(I(z),z=-1):C=!0,J(O,V-nt))):(F.sortIndex=mt,t(d,F),b||x||(b=!0,U||(U=!0,K()))),F},s.unstable_shouldYield=k,s.unstable_wrapCallback=function(F){var N=v;return function(){var V=v;v=N;try{return F.apply(this,arguments)}finally{v=V}}}})(Ld)),Ld}var Z_;function Fb(){return Z_||(Z_=1,Ud.exports=zb()),Ud.exports}var Nd={exports:{}},ye={};var K_;function Hb(){if(K_)return ye;K_=1;var s=Symbol.for("react.transitional.element"),t=Symbol.for("react.portal"),e=Symbol.for("react.fragment"),a=Symbol.for("react.strict_mode"),o=Symbol.for("react.profiler"),l=Symbol.for("react.consumer"),u=Symbol.for("react.context"),h=Symbol.for("react.forward_ref"),d=Symbol.for("react.suspense"),p=Symbol.for("react.memo"),g=Symbol.for("react.lazy"),_=Symbol.for("react.activity"),v=Symbol.iterator;function x(L){return L===null||typeof L!="object"?null:(L=v&&L[v]||L["@@iterator"],typeof L=="function"?L:null)}var b={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},C=Object.assign,M={};function y(L,X,_t){this.props=L,this.context=X,this.refs=M,this.updater=_t||b}y.prototype.isReactComponent={},y.prototype.setState=function(L,X){if(typeof L!="object"&&typeof L!="function"&&L!=null)throw Error("takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,L,X,"setState")},y.prototype.forceUpdate=function(L){this.updater.enqueueForceUpdate(this,L,"forceUpdate")};function I(){}I.prototype=y.prototype;function D(L,X,_t){this.props=L,this.context=X,this.refs=M,this.updater=_t||b}var A=D.prototype=new I;A.constructor=D,C(A,y.prototype),A.isPureReactComponent=!0;var O=Array.isArray;function U(){}var z={H:null,A:null,T:null,S:null},T=Object.prototype.hasOwnProperty;function P(L,X,_t){var Ct=_t.ref;return{$$typeof:s,type:L,key:X,ref:Ct!==void 0?Ct:null,props:_t}}function k(L,X){return P(L.type,X,L.props)}function H(L){return typeof L=="object"&&L!==null&&L.$$typeof===s}function K(L){var X={"=":"=0",":":"=2"};return"$"+L.replace(/[=:]/g,function(_t){return X[_t]})}var ft=/\/+/g;function dt(L,X){return typeof L=="object"&&L!==null&&L.key!=null?K(""+L.key):X.toString(36)}function J(L){switch(L.status){case"fulfilled":return L.value;case"rejected":throw L.reason;default:switch(typeof L.status=="string"?L.then(U,U):(L.status="pending",L.then(function(X){L.status==="pending"&&(L.status="fulfilled",L.value=X)},function(X){L.status==="pending"&&(L.status="rejected",L.reason=X)})),L.status){case"fulfilled":return L.value;case"rejected":throw L.reason}}throw L}function F(L,X,_t,Ct,Lt){var et=typeof L;(et==="undefined"||et==="boolean")&&(L=null);var Mt=!1;if(L===null)Mt=!0;else switch(et){case"bigint":case"string":case"number":Mt=!0;break;case"object":switch(L.$$typeof){case s:case t:Mt=!0;break;case g:return Mt=L._init,F(Mt(L._payload),X,_t,Ct,Lt)}}if(Mt)return Lt=Lt(L),Mt=Ct===""?"."+dt(L,0):Ct,O(Lt)?(_t="",Mt!=null&&(_t=Mt.replace(ft,"$&/")+"/"),F(Lt,X,_t,"",function(oe){return oe})):Lt!=null&&(H(Lt)&&(Lt=k(Lt,_t+(Lt.key==null||L&&L.key===Lt.key?"":(""+Lt.key).replace(ft,"$&/")+"/")+Mt)),X.push(Lt)),1;Mt=0;var Et=Ct===""?".":Ct+":";if(O(L))for(var zt=0;zt<L.length;zt++)Ct=L[zt],et=Et+dt(Ct,zt),Mt+=F(Ct,X,_t,et,Lt);else if(zt=x(L),typeof zt=="function")for(L=zt.call(L),zt=0;!(Ct=L.next()).done;)Ct=Ct.value,et=Et+dt(Ct,zt++),Mt+=F(Ct,X,_t,et,Lt);else if(et==="object"){if(typeof L.then=="function")return F(J(L),X,_t,Ct,Lt);throw X=String(L),Error("Objects are not valid as a React child (found: "+(X==="[object Object]"?"object with keys {"+Object.keys(L).join(", ")+"}":X)+"). If you meant to render a collection of children, use an array instead.")}return Mt}function N(L,X,_t){if(L==null)return L;var Ct=[],Lt=0;return F(L,Ct,"","",function(et){return X.call(_t,et,Lt++)}),Ct}function V(L){if(L._status===-1){var X=L._result;X=X(),X.then(function(_t){(L._status===0||L._status===-1)&&(L._status=1,L._result=_t)},function(_t){(L._status===0||L._status===-1)&&(L._status=2,L._result=_t)}),L._status===-1&&(L._status=0,L._result=X)}if(L._status===1)return L._result.default;throw L._result}var nt=typeof reportError=="function"?reportError:function(L){if(typeof window=="object"&&typeof window.ErrorEvent=="function"){var X=new window.ErrorEvent("error",{bubbles:!0,cancelable:!0,message:typeof L=="object"&&L!==null&&typeof L.message=="string"?String(L.message):String(L),error:L});if(!window.dispatchEvent(X))return}else if(typeof process=="object"&&typeof process.emit=="function"){process.emit("uncaughtException",L);return}console.error(L)},mt={map:N,forEach:function(L,X,_t){N(L,function(){X.apply(this,arguments)},_t)},count:function(L){var X=0;return N(L,function(){X++}),X},toArray:function(L){return N(L,function(X){return X})||[]},only:function(L){if(!H(L))throw Error("React.Children.only expected to receive a single React element child.");return L}};return ye.Activity=_,ye.Children=mt,ye.Component=y,ye.Fragment=e,ye.Profiler=o,ye.PureComponent=D,ye.StrictMode=a,ye.Suspense=d,ye.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=z,ye.__COMPILER_RUNTIME={__proto__:null,c:function(L){return z.H.useMemoCache(L)}},ye.cache=function(L){return function(){return L.apply(null,arguments)}},ye.cacheSignal=function(){return null},ye.cloneElement=function(L,X,_t){if(L==null)throw Error("The argument must be a React element, but you passed "+L+".");var Ct=C({},L.props),Lt=L.key;if(X!=null)for(et in X.key!==void 0&&(Lt=""+X.key),X)!T.call(X,et)||et==="key"||et==="__self"||et==="__source"||et==="ref"&&X.ref===void 0||(Ct[et]=X[et]);var et=arguments.length-2;if(et===1)Ct.children=_t;else if(1<et){for(var Mt=Array(et),Et=0;Et<et;Et++)Mt[Et]=arguments[Et+2];Ct.children=Mt}return P(L.type,Lt,Ct)},ye.createContext=function(L){return L={$$typeof:u,_currentValue:L,_currentValue2:L,_threadCount:0,Provider:null,Consumer:null},L.Provider=L,L.Consumer={$$typeof:l,_context:L},L},ye.createElement=function(L,X,_t){var Ct,Lt={},et=null;if(X!=null)for(Ct in X.key!==void 0&&(et=""+X.key),X)T.call(X,Ct)&&Ct!=="key"&&Ct!=="__self"&&Ct!=="__source"&&(Lt[Ct]=X[Ct]);var Mt=arguments.length-2;if(Mt===1)Lt.children=_t;else if(1<Mt){for(var Et=Array(Mt),zt=0;zt<Mt;zt++)Et[zt]=arguments[zt+2];Lt.children=Et}if(L&&L.defaultProps)for(Ct in Mt=L.defaultProps,Mt)Lt[Ct]===void 0&&(Lt[Ct]=Mt[Ct]);return P(L,et,Lt)},ye.createRef=function(){return{current:null}},ye.forwardRef=function(L){return{$$typeof:h,render:L}},ye.isValidElement=H,ye.lazy=function(L){return{$$typeof:g,_payload:{_status:-1,_result:L},_init:V}},ye.memo=function(L,X){return{$$typeof:p,type:L,compare:X===void 0?null:X}},ye.startTransition=function(L){var X=z.T,_t={};z.T=_t;try{var Ct=L(),Lt=z.S;Lt!==null&&Lt(_t,Ct),typeof Ct=="object"&&Ct!==null&&typeof Ct.then=="function"&&Ct.then(U,nt)}catch(et){nt(et)}finally{X!==null&&_t.types!==null&&(X.types=_t.types),z.T=X}},ye.unstable_useCacheRefresh=function(){return z.H.useCacheRefresh()},ye.use=function(L){return z.H.use(L)},ye.useActionState=function(L,X,_t){return z.H.useActionState(L,X,_t)},ye.useCallback=function(L,X){return z.H.useCallback(L,X)},ye.useContext=function(L){return z.H.useContext(L)},ye.useDebugValue=function(){},ye.useDeferredValue=function(L,X){return z.H.useDeferredValue(L,X)},ye.useEffect=function(L,X){return z.H.useEffect(L,X)},ye.useEffectEvent=function(L){return z.H.useEffectEvent(L)},ye.useId=function(){return z.H.useId()},ye.useImperativeHandle=function(L,X,_t){return z.H.useImperativeHandle(L,X,_t)},ye.useInsertionEffect=function(L,X){return z.H.useInsertionEffect(L,X)},ye.useLayoutEffect=function(L,X){return z.H.useLayoutEffect(L,X)},ye.useMemo=function(L,X){return z.H.useMemo(L,X)},ye.useOptimistic=function(L,X){return z.H.useOptimistic(L,X)},ye.useReducer=function(L,X,_t){return z.H.useReducer(L,X,_t)},ye.useRef=function(L){return z.H.useRef(L)},ye.useState=function(L){return z.H.useState(L)},ye.useSyncExternalStore=function(L,X,_t){return z.H.useSyncExternalStore(L,X,_t)},ye.useTransition=function(){return z.H.useTransition()},ye.version="19.2.6",ye}var J_;function wm(){return J_||(J_=1,Nd.exports=Hb()),Nd.exports}var Od={exports:{}},Kn={};var Q_;function Gb(){if(Q_)return Kn;Q_=1;var s=wm();function t(d){var p="https://react.dev/errors/"+d;if(1<arguments.length){p+="?args[]="+encodeURIComponent(arguments[1]);for(var g=2;g<arguments.length;g++)p+="&args[]="+encodeURIComponent(arguments[g])}return"Minified React error #"+d+"; visit "+p+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}function e(){}var a={d:{f:e,r:function(){throw Error(t(522))},D:e,C:e,L:e,m:e,X:e,S:e,M:e},p:0,findDOMNode:null},o=Symbol.for("react.portal");function l(d,p,g){var _=3<arguments.length&&arguments[3]!==void 0?arguments[3]:null;return{$$typeof:o,key:_==null?null:""+_,children:d,containerInfo:p,implementation:g}}var u=s.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;function h(d,p){if(d==="font")return"";if(typeof p=="string")return p==="use-credentials"?p:""}return Kn.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE=a,Kn.createPortal=function(d,p){var g=2<arguments.length&&arguments[2]!==void 0?arguments[2]:null;if(!p||p.nodeType!==1&&p.nodeType!==9&&p.nodeType!==11)throw Error(t(299));return l(d,p,null,g)},Kn.flushSync=function(d){var p=u.T,g=a.p;try{if(u.T=null,a.p=2,d)return d()}finally{u.T=p,a.p=g,a.d.f()}},Kn.preconnect=function(d,p){typeof d=="string"&&(p?(p=p.crossOrigin,p=typeof p=="string"?p==="use-credentials"?p:"":void 0):p=null,a.d.C(d,p))},Kn.prefetchDNS=function(d){typeof d=="string"&&a.d.D(d)},Kn.preinit=function(d,p){if(typeof d=="string"&&p&&typeof p.as=="string"){var g=p.as,_=h(g,p.crossOrigin),v=typeof p.integrity=="string"?p.integrity:void 0,x=typeof p.fetchPriority=="string"?p.fetchPriority:void 0;g==="style"?a.d.S(d,typeof p.precedence=="string"?p.precedence:void 0,{crossOrigin:_,integrity:v,fetchPriority:x}):g==="script"&&a.d.X(d,{crossOrigin:_,integrity:v,fetchPriority:x,nonce:typeof p.nonce=="string"?p.nonce:void 0})}},Kn.preinitModule=function(d,p){if(typeof d=="string")if(typeof p=="object"&&p!==null){if(p.as==null||p.as==="script"){var g=h(p.as,p.crossOrigin);a.d.M(d,{crossOrigin:g,integrity:typeof p.integrity=="string"?p.integrity:void 0,nonce:typeof p.nonce=="string"?p.nonce:void 0})}}else p==null&&a.d.M(d)},Kn.preload=function(d,p){if(typeof d=="string"&&typeof p=="object"&&p!==null&&typeof p.as=="string"){var g=p.as,_=h(g,p.crossOrigin);a.d.L(d,g,{crossOrigin:_,integrity:typeof p.integrity=="string"?p.integrity:void 0,nonce:typeof p.nonce=="string"?p.nonce:void 0,type:typeof p.type=="string"?p.type:void 0,fetchPriority:typeof p.fetchPriority=="string"?p.fetchPriority:void 0,referrerPolicy:typeof p.referrerPolicy=="string"?p.referrerPolicy:void 0,imageSrcSet:typeof p.imageSrcSet=="string"?p.imageSrcSet:void 0,imageSizes:typeof p.imageSizes=="string"?p.imageSizes:void 0,media:typeof p.media=="string"?p.media:void 0})}},Kn.preloadModule=function(d,p){if(typeof d=="string")if(p){var g=h(p.as,p.crossOrigin);a.d.m(d,{as:typeof p.as=="string"&&p.as!=="script"?p.as:void 0,crossOrigin:g,integrity:typeof p.integrity=="string"?p.integrity:void 0})}else a.d.m(d)},Kn.requestFormReset=function(d){a.d.r(d)},Kn.unstable_batchedUpdates=function(d,p){return d(p)},Kn.useFormState=function(d,p,g){return u.H.useFormState(d,p,g)},Kn.useFormStatus=function(){return u.H.useHostTransitionStatus()},Kn.version="19.2.6",Kn}var $_;function Vb(){if($_)return Od.exports;$_=1;function s(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(s)}catch(t){console.error(t)}}return s(),Od.exports=Gb(),Od.exports}var j_;function kb(){if(j_)return Il;j_=1;var s=Fb(),t=wm(),e=Vb();function a(n){var i="https://react.dev/errors/"+n;if(1<arguments.length){i+="?args[]="+encodeURIComponent(arguments[1]);for(var r=2;r<arguments.length;r++)i+="&args[]="+encodeURIComponent(arguments[r])}return"Minified React error #"+n+"; visit "+i+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}function o(n){return!(!n||n.nodeType!==1&&n.nodeType!==9&&n.nodeType!==11)}function l(n){var i=n,r=n;if(n.alternate)for(;i.return;)i=i.return;else{n=i;do i=n,(i.flags&4098)!==0&&(r=i.return),n=i.return;while(n)}return i.tag===3?r:null}function u(n){if(n.tag===13){var i=n.memoizedState;if(i===null&&(n=n.alternate,n!==null&&(i=n.memoizedState)),i!==null)return i.dehydrated}return null}function h(n){if(n.tag===31){var i=n.memoizedState;if(i===null&&(n=n.alternate,n!==null&&(i=n.memoizedState)),i!==null)return i.dehydrated}return null}function d(n){if(l(n)!==n)throw Error(a(188))}function p(n){var i=n.alternate;if(!i){if(i=l(n),i===null)throw Error(a(188));return i!==n?null:n}for(var r=n,c=i;;){var f=r.return;if(f===null)break;var m=f.alternate;if(m===null){if(c=f.return,c!==null){r=c;continue}break}if(f.child===m.child){for(m=f.child;m;){if(m===r)return d(f),n;if(m===c)return d(f),i;m=m.sibling}throw Error(a(188))}if(r.return!==c.return)r=f,c=m;else{for(var S=!1,R=f.child;R;){if(R===r){S=!0,r=f,c=m;break}if(R===c){S=!0,c=f,r=m;break}R=R.sibling}if(!S){for(R=m.child;R;){if(R===r){S=!0,r=m,c=f;break}if(R===c){S=!0,c=m,r=f;break}R=R.sibling}if(!S)throw Error(a(189))}}if(r.alternate!==c)throw Error(a(190))}if(r.tag!==3)throw Error(a(188));return r.stateNode.current===r?n:i}function g(n){var i=n.tag;if(i===5||i===26||i===27||i===6)return n;for(n=n.child;n!==null;){if(i=g(n),i!==null)return i;n=n.sibling}return null}var _=Object.assign,v=Symbol.for("react.element"),x=Symbol.for("react.transitional.element"),b=Symbol.for("react.portal"),C=Symbol.for("react.fragment"),M=Symbol.for("react.strict_mode"),y=Symbol.for("react.profiler"),I=Symbol.for("react.consumer"),D=Symbol.for("react.context"),A=Symbol.for("react.forward_ref"),O=Symbol.for("react.suspense"),U=Symbol.for("react.suspense_list"),z=Symbol.for("react.memo"),T=Symbol.for("react.lazy"),P=Symbol.for("react.activity"),k=Symbol.for("react.memo_cache_sentinel"),H=Symbol.iterator;function K(n){return n===null||typeof n!="object"?null:(n=H&&n[H]||n["@@iterator"],typeof n=="function"?n:null)}var ft=Symbol.for("react.client.reference");function dt(n){if(n==null)return null;if(typeof n=="function")return n.$$typeof===ft?null:n.displayName||n.name||null;if(typeof n=="string")return n;switch(n){case C:return"Fragment";case y:return"Profiler";case M:return"StrictMode";case O:return"Suspense";case U:return"SuspenseList";case P:return"Activity"}if(typeof n=="object")switch(n.$$typeof){case b:return"Portal";case D:return n.displayName||"Context";case I:return(n._context.displayName||"Context")+".Consumer";case A:var i=n.render;return n=n.displayName,n||(n=i.displayName||i.name||"",n=n!==""?"ForwardRef("+n+")":"ForwardRef"),n;case z:return i=n.displayName||null,i!==null?i:dt(n.type)||"Memo";case T:i=n._payload,n=n._init;try{return dt(n(i))}catch{}}return null}var J=Array.isArray,F=t.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,N=e.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,V={pending:!1,data:null,method:null,action:null},nt=[],mt=-1;function L(n){return{current:n}}function X(n){0>mt||(n.current=nt[mt],nt[mt]=null,mt--)}function _t(n,i){mt++,nt[mt]=n.current,n.current=i}var Ct=L(null),Lt=L(null),et=L(null),Mt=L(null);function Et(n,i){switch(_t(et,i),_t(Lt,n),_t(Ct,null),i.nodeType){case 9:case 11:n=(n=i.documentElement)&&(n=n.namespaceURI)?p_(n):0;break;default:if(n=i.tagName,i=i.namespaceURI)i=p_(i),n=m_(i,n);else switch(n){case"svg":n=1;break;case"math":n=2;break;default:n=0}}X(Ct),_t(Ct,n)}function zt(){X(Ct),X(Lt),X(et)}function oe(n){n.memoizedState!==null&&_t(Mt,n);var i=Ct.current,r=m_(i,n.type);i!==r&&(_t(Lt,n),_t(Ct,r))}function ae(n){Lt.current===n&&(X(Ct),X(Lt)),Mt.current===n&&(X(Mt),Ll._currentValue=V)}var Pe,me;function Tt(n){if(Pe===void 0)try{throw Error()}catch(r){var i=r.stack.trim().match(/\n( *(at )?)/);Pe=i&&i[1]||"",me=-1<r.stack.indexOf(`
    at`)?" (<anonymous>)":-1<r.stack.indexOf("@")?"@unknown:0:0":""}return`
`+Pe+n+me}var Rt=!1;function wt(n,i){if(!n||Rt)return"";Rt=!0;var r=Error.prepareStackTrace;Error.prepareStackTrace=void 0;try{var c={DetermineComponentFrameRoot:function(){try{if(i){var bt=function(){throw Error()};if(Object.defineProperty(bt.prototype,"props",{set:function(){throw Error()}}),typeof Reflect=="object"&&Reflect.construct){try{Reflect.construct(bt,[])}catch(ht){var ct=ht}Reflect.construct(n,[],bt)}else{try{bt.call()}catch(ht){ct=ht}n.call(bt.prototype)}}else{try{throw Error()}catch(ht){ct=ht}(bt=n())&&typeof bt.catch=="function"&&bt.catch(function(){})}}catch(ht){if(ht&&ct&&typeof ht.stack=="string")return[ht.stack,ct.stack]}return[null,null]}};c.DetermineComponentFrameRoot.displayName="DetermineComponentFrameRoot";var f=Object.getOwnPropertyDescriptor(c.DetermineComponentFrameRoot,"name");f&&f.configurable&&Object.defineProperty(c.DetermineComponentFrameRoot,"name",{value:"DetermineComponentFrameRoot"});var m=c.DetermineComponentFrameRoot(),S=m[0],R=m[1];if(S&&R){var G=S.split(`
`),at=R.split(`
`);for(f=c=0;c<G.length&&!G[c].includes("DetermineComponentFrameRoot");)c++;for(;f<at.length&&!at[f].includes("DetermineComponentFrameRoot");)f++;if(c===G.length||f===at.length)for(c=G.length-1,f=at.length-1;1<=c&&0<=f&&G[c]!==at[f];)f--;for(;1<=c&&0<=f;c--,f--)if(G[c]!==at[f]){if(c!==1||f!==1)do if(c--,f--,0>f||G[c]!==at[f]){var xt=`
`+G[c].replace(" at new "," at ");return n.displayName&&xt.includes("<anonymous>")&&(xt=xt.replace("<anonymous>",n.displayName)),xt}while(1<=c&&0<=f);break}}}finally{Rt=!1,Error.prepareStackTrace=r}return(r=n?n.displayName||n.name:"")?Tt(r):""}function kt(n,i){switch(n.tag){case 26:case 27:case 5:return Tt(n.type);case 16:return Tt("Lazy");case 13:return n.child!==i&&i!==null?Tt("Suspense Fallback"):Tt("Suspense");case 19:return Tt("SuspenseList");case 0:case 15:return wt(n.type,!1);case 11:return wt(n.type.render,!1);case 1:return wt(n.type,!0);case 31:return Tt("Activity");default:return""}}function Gt(n){try{var i="",r=null;do i+=kt(n,r),r=n,n=n.return;while(n);return i}catch(c){return`
Error generating stack: `+c.message+`
`+c.stack}}var le=Object.prototype.hasOwnProperty,ne=s.unstable_scheduleCallback,he=s.unstable_cancelCallback,xe=s.unstable_shouldYield,W=s.unstable_requestPaint,Me=s.unstable_now,we=s.unstable_getCurrentPriorityLevel,B=s.unstable_ImmediatePriority,E=s.unstable_UserBlockingPriority,tt=s.unstable_NormalPriority,ot=s.unstable_LowPriority,gt=s.unstable_IdlePriority,Dt=s.log,Bt=s.unstable_setDisableYieldValue,pt=null,vt=null;function Ot(n){if(typeof Dt=="function"&&Bt(n),vt&&typeof vt.setStrictMode=="function")try{vt.setStrictMode(pt,n)}catch{}}var Yt=Math.clz32?Math.clz32:re,Vt=Math.log,Ft=Math.LN2;function re(n){return n>>>=0,n===0?32:31-(Vt(n)/Ft|0)|0}var ce=256,ve=262144,Z=4194304;function Nt(n){var i=n&42;if(i!==0)return i;switch(n&-n){case 1:return 1;case 2:return 2;case 4:return 4;case 8:return 8;case 16:return 16;case 32:return 32;case 64:return 64;case 128:return 128;case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:return n&261888;case 262144:case 524288:case 1048576:case 2097152:return n&3932160;case 4194304:case 8388608:case 16777216:case 33554432:return n&62914560;case 67108864:return 67108864;case 134217728:return 134217728;case 268435456:return 268435456;case 536870912:return 536870912;case 1073741824:return 0;default:return n}}function yt(n,i,r){var c=n.pendingLanes;if(c===0)return 0;var f=0,m=n.suspendedLanes,S=n.pingedLanes;n=n.warmLanes;var R=c&134217727;return R!==0?(c=R&~m,c!==0?f=Nt(c):(S&=R,S!==0?f=Nt(S):r||(r=R&~n,r!==0&&(f=Nt(r))))):(R=c&~m,R!==0?f=Nt(R):S!==0?f=Nt(S):r||(r=c&~n,r!==0&&(f=Nt(r)))),f===0?0:i!==0&&i!==f&&(i&m)===0&&(m=f&-f,r=i&-i,m>=r||m===32&&(r&4194048)!==0)?i:f}function It(n,i){return(n.pendingLanes&~(n.suspendedLanes&~n.pingedLanes)&i)===0}function qt(n,i){switch(n){case 1:case 2:case 4:case 8:case 64:return i+250;case 16:case 32:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return i+5e3;case 4194304:case 8388608:case 16777216:case 33554432:return-1;case 67108864:case 134217728:case 268435456:case 536870912:case 1073741824:return-1;default:return-1}}function At(){var n=Z;return Z<<=1,(Z&62914560)===0&&(Z=4194304),n}function ee(n){for(var i=[],r=0;31>r;r++)i.push(n);return i}function Qt(n,i){n.pendingLanes|=i,i!==268435456&&(n.suspendedLanes=0,n.pingedLanes=0,n.warmLanes=0)}function cn(n,i,r,c,f,m){var S=n.pendingLanes;n.pendingLanes=r,n.suspendedLanes=0,n.pingedLanes=0,n.warmLanes=0,n.expiredLanes&=r,n.entangledLanes&=r,n.errorRecoveryDisabledLanes&=r,n.shellSuspendCounter=0;var R=n.entanglements,G=n.expirationTimes,at=n.hiddenUpdates;for(r=S&~r;0<r;){var xt=31-Yt(r),bt=1<<xt;R[xt]=0,G[xt]=-1;var ct=at[xt];if(ct!==null)for(at[xt]=null,xt=0;xt<ct.length;xt++){var ht=ct[xt];ht!==null&&(ht.lane&=-536870913)}r&=~bt}c!==0&&Xe(n,c,0),m!==0&&f===0&&n.tag!==0&&(n.suspendedLanes|=m&~(S&~i))}function Xe(n,i,r){n.pendingLanes|=i,n.suspendedLanes&=~i;var c=31-Yt(i);n.entangledLanes|=i,n.entanglements[c]=n.entanglements[c]|1073741824|r&261930}function gi(n,i){var r=n.entangledLanes|=i;for(n=n.entanglements;r;){var c=31-Yt(r),f=1<<c;f&i|n[c]&i&&(n[c]|=i),r&=~f}}function vi(n,i){var r=i&-i;return r=(r&42)!==0?1:qo(r),(r&(n.suspendedLanes|i))!==0?0:r}function qo(n){switch(n){case 2:n=1;break;case 8:n=4;break;case 32:n=16;break;case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:n=128;break;case 268435456:n=134217728;break;default:n=0}return n}function Yo(n){return n&=-n,2<n?8<n?(n&134217727)!==0?32:268435456:8:2}function Zo(){var n=N.p;return n!==0?n:(n=window.event,n===void 0?32:z_(n.type))}function wr(n,i){var r=N.p;try{return N.p=n,i()}finally{N.p=r}}var na=Math.random().toString(36).slice(2),Mn="__reactFiber$"+na,zn="__reactProps$"+na,ci="__reactContainer$"+na,Vs="__reactEvents$"+na,mc="__reactListeners$"+na,gc="__reactHandles$"+na,ks="__reactResources$"+na,es="__reactMarker$"+na;function ns(n){delete n[Mn],delete n[zn],delete n[Vs],delete n[mc],delete n[gc]}function _a(n){var i=n[Mn];if(i)return i;for(var r=n.parentNode;r;){if(i=r[ci]||r[Mn]){if(r=i.alternate,i.child!==null||r!==null&&r.child!==null)for(n=M_(n);n!==null;){if(r=n[Mn])return r;n=M_(n)}return i}n=r,r=n.parentNode}return null}function xa(n){if(n=n[Mn]||n[ci]){var i=n.tag;if(i===5||i===6||i===13||i===31||i===26||i===27||i===3)return n}return null}function Xs(n){var i=n.tag;if(i===5||i===26||i===27||i===6)return n.stateNode;throw Error(a(33))}function is(n){var i=n[ks];return i||(i=n[ks]={hoistableStyles:new Map,hoistableScripts:new Map}),i}function bn(n){n[es]=!0}var vc=new Set,w={};function Q(n,i){lt(n,i),lt(n+"Capture",i)}function lt(n,i){for(w[n]=i,n=0;n<i.length;n++)vc.add(i[n])}var st=RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"),rt={},Xt={};function Jt(n){return le.call(Xt,n)?!0:le.call(rt,n)?!1:st.test(n)?Xt[n]=!0:(rt[n]=!0,!1)}function Ht(n,i,r){if(Jt(i))if(r===null)n.removeAttribute(i);else{switch(typeof r){case"undefined":case"function":case"symbol":n.removeAttribute(i);return;case"boolean":var c=i.toLowerCase().slice(0,5);if(c!=="data-"&&c!=="aria-"){n.removeAttribute(i);return}}n.setAttribute(i,""+r)}}function jt(n,i,r){if(r===null)n.removeAttribute(i);else{switch(typeof r){case"undefined":case"function":case"symbol":case"boolean":n.removeAttribute(i);return}n.setAttribute(i,""+r)}}function $t(n,i,r,c){if(c===null)n.removeAttribute(r);else{switch(typeof c){case"undefined":case"function":case"symbol":case"boolean":n.removeAttribute(r);return}n.setAttributeNS(i,r,""+c)}}function ue(n){switch(typeof n){case"bigint":case"boolean":case"number":case"string":case"undefined":return n;case"object":return n;default:return""}}function be(n){var i=n.type;return(n=n.nodeName)&&n.toLowerCase()==="input"&&(i==="checkbox"||i==="radio")}function se(n,i,r){var c=Object.getOwnPropertyDescriptor(n.constructor.prototype,i);if(!n.hasOwnProperty(i)&&typeof c<"u"&&typeof c.get=="function"&&typeof c.set=="function"){var f=c.get,m=c.set;return Object.defineProperty(n,i,{configurable:!0,get:function(){return f.call(this)},set:function(S){r=""+S,m.call(this,S)}}),Object.defineProperty(n,i,{enumerable:c.enumerable}),{getValue:function(){return r},setValue:function(S){r=""+S},stopTracking:function(){n._valueTracker=null,delete n[i]}}}}function ze(n){if(!n._valueTracker){var i=be(n)?"checked":"value";n._valueTracker=se(n,i,""+n[i])}}function un(n){if(!n)return!1;var i=n._valueTracker;if(!i)return!0;var r=i.getValue(),c="";return n&&(c=be(n)?n.checked?"true":"false":n.value),n=c,n!==r?(i.setValue(n),!0):!1}function nn(n){if(n=n||(typeof document<"u"?document:void 0),typeof n>"u")return null;try{return n.activeElement||n.body}catch{return n.body}}var We=/[\n"\\]/g;function qe(n){return n.replace(We,function(i){return"\\"+i.charCodeAt(0).toString(16)+" "})}function Zt(n,i,r,c,f,m,S,R){n.name="",S!=null&&typeof S!="function"&&typeof S!="symbol"&&typeof S!="boolean"?n.type=S:n.removeAttribute("type"),i!=null?S==="number"?(i===0&&n.value===""||n.value!=i)&&(n.value=""+ue(i)):n.value!==""+ue(i)&&(n.value=""+ue(i)):S!=="submit"&&S!=="reset"||n.removeAttribute("value"),i!=null?Re(n,S,ue(i)):r!=null?Re(n,S,ue(r)):c!=null&&n.removeAttribute("value"),f==null&&m!=null&&(n.defaultChecked=!!m),f!=null&&(n.checked=f&&typeof f!="function"&&typeof f!="symbol"),R!=null&&typeof R!="function"&&typeof R!="symbol"&&typeof R!="boolean"?n.name=""+ue(R):n.removeAttribute("name")}function Zn(n,i,r,c,f,m,S,R){if(m!=null&&typeof m!="function"&&typeof m!="symbol"&&typeof m!="boolean"&&(n.type=m),i!=null||r!=null){if(!(m!=="submit"&&m!=="reset"||i!=null)){ze(n);return}r=r!=null?""+ue(r):"",i=i!=null?""+ue(i):r,R||i===n.value||(n.value=i),n.defaultValue=i}c=c??f,c=typeof c!="function"&&typeof c!="symbol"&&!!c,n.checked=R?n.checked:!!c,n.defaultChecked=!!c,S!=null&&typeof S!="function"&&typeof S!="symbol"&&typeof S!="boolean"&&(n.name=S),ze(n)}function Re(n,i,r){i==="number"&&nn(n.ownerDocument)===n||n.defaultValue===""+r||(n.defaultValue=""+r)}function Dn(n,i,r,c){if(n=n.options,i){i={};for(var f=0;f<r.length;f++)i["$"+r[f]]=!0;for(r=0;r<n.length;r++)f=i.hasOwnProperty("$"+n[r].value),n[r].selected!==f&&(n[r].selected=f),f&&c&&(n[r].defaultSelected=!0)}else{for(r=""+ue(r),i=null,f=0;f<n.length;f++){if(n[f].value===r){n[f].selected=!0,c&&(n[f].defaultSelected=!0);return}i!==null||n[f].disabled||(i=n[f])}i!==null&&(i.selected=!0)}}function _i(n,i,r){if(i!=null&&(i=""+ue(i),i!==n.value&&(n.value=i),r==null)){n.defaultValue!==i&&(n.defaultValue=i);return}n.defaultValue=r!=null?""+ue(r):""}function Xi(n,i,r,c){if(i==null){if(c!=null){if(r!=null)throw Error(a(92));if(J(c)){if(1<c.length)throw Error(a(93));c=c[0]}r=c}r==null&&(r=""),i=r}r=ue(i),n.defaultValue=r,c=n.textContent,c===r&&c!==""&&c!==null&&(n.value=c),ze(n)}function xi(n,i){if(i){var r=n.firstChild;if(r&&r===n.lastChild&&r.nodeType===3){r.nodeValue=i;return}}n.textContent=i}var Ye=new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));function fn(n,i,r){var c=i.indexOf("--")===0;r==null||typeof r=="boolean"||r===""?c?n.setProperty(i,""):i==="float"?n.cssFloat="":n[i]="":c?n.setProperty(i,r):typeof r!="number"||r===0||Ye.has(i)?i==="float"?n.cssFloat=r:n[i]=(""+r).trim():n[i]=r+"px"}function Wi(n,i,r){if(i!=null&&typeof i!="object")throw Error(a(62));if(n=n.style,r!=null){for(var c in r)!r.hasOwnProperty(c)||i!=null&&i.hasOwnProperty(c)||(c.indexOf("--")===0?n.setProperty(c,""):c==="float"?n.cssFloat="":n[c]="");for(var f in i)c=i[f],i.hasOwnProperty(f)&&r[f]!==c&&fn(n,f,c)}else for(var m in i)i.hasOwnProperty(m)&&fn(n,m,i[m])}function ke(n){if(n.indexOf("-")===-1)return!1;switch(n){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1;default:return!0}}var ia=new Map([["acceptCharset","accept-charset"],["htmlFor","for"],["httpEquiv","http-equiv"],["crossOrigin","crossorigin"],["accentHeight","accent-height"],["alignmentBaseline","alignment-baseline"],["arabicForm","arabic-form"],["baselineShift","baseline-shift"],["capHeight","cap-height"],["clipPath","clip-path"],["clipRule","clip-rule"],["colorInterpolation","color-interpolation"],["colorInterpolationFilters","color-interpolation-filters"],["colorProfile","color-profile"],["colorRendering","color-rendering"],["dominantBaseline","dominant-baseline"],["enableBackground","enable-background"],["fillOpacity","fill-opacity"],["fillRule","fill-rule"],["floodColor","flood-color"],["floodOpacity","flood-opacity"],["fontFamily","font-family"],["fontSize","font-size"],["fontSizeAdjust","font-size-adjust"],["fontStretch","font-stretch"],["fontStyle","font-style"],["fontVariant","font-variant"],["fontWeight","font-weight"],["glyphName","glyph-name"],["glyphOrientationHorizontal","glyph-orientation-horizontal"],["glyphOrientationVertical","glyph-orientation-vertical"],["horizAdvX","horiz-adv-x"],["horizOriginX","horiz-origin-x"],["imageRendering","image-rendering"],["letterSpacing","letter-spacing"],["lightingColor","lighting-color"],["markerEnd","marker-end"],["markerMid","marker-mid"],["markerStart","marker-start"],["overlinePosition","overline-position"],["overlineThickness","overline-thickness"],["paintOrder","paint-order"],["panose-1","panose-1"],["pointerEvents","pointer-events"],["renderingIntent","rendering-intent"],["shapeRendering","shape-rendering"],["stopColor","stop-color"],["stopOpacity","stop-opacity"],["strikethroughPosition","strikethrough-position"],["strikethroughThickness","strikethrough-thickness"],["strokeDasharray","stroke-dasharray"],["strokeDashoffset","stroke-dashoffset"],["strokeLinecap","stroke-linecap"],["strokeLinejoin","stroke-linejoin"],["strokeMiterlimit","stroke-miterlimit"],["strokeOpacity","stroke-opacity"],["strokeWidth","stroke-width"],["textAnchor","text-anchor"],["textDecoration","text-decoration"],["textRendering","text-rendering"],["transformOrigin","transform-origin"],["underlinePosition","underline-position"],["underlineThickness","underline-thickness"],["unicodeBidi","unicode-bidi"],["unicodeRange","unicode-range"],["unitsPerEm","units-per-em"],["vAlphabetic","v-alphabetic"],["vHanging","v-hanging"],["vIdeographic","v-ideographic"],["vMathematical","v-mathematical"],["vectorEffect","vector-effect"],["vertAdvY","vert-adv-y"],["vertOriginX","vert-origin-x"],["vertOriginY","vert-origin-y"],["wordSpacing","word-spacing"],["writingMode","writing-mode"],["xmlnsXlink","xmlns:xlink"],["xHeight","x-height"]]),as=/^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;function Ws(n){return as.test(""+n)?"javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')":n}function ya(){}var Af=null;function wf(n){return n=n.target||n.srcElement||window,n.correspondingUseElement&&(n=n.correspondingUseElement),n.nodeType===3?n.parentNode:n}var Rr=null,Cr=null;function dg(n){var i=xa(n);if(i&&(n=i.stateNode)){var r=n[zn]||null;t:switch(n=i.stateNode,i.type){case"input":if(Zt(n,r.value,r.defaultValue,r.defaultValue,r.checked,r.defaultChecked,r.type,r.name),i=r.name,r.type==="radio"&&i!=null){for(r=n;r.parentNode;)r=r.parentNode;for(r=r.querySelectorAll('input[name="'+qe(""+i)+'"][type="radio"]'),i=0;i<r.length;i++){var c=r[i];if(c!==n&&c.form===n.form){var f=c[zn]||null;if(!f)throw Error(a(90));Zt(c,f.value,f.defaultValue,f.defaultValue,f.checked,f.defaultChecked,f.type,f.name)}}for(i=0;i<r.length;i++)c=r[i],c.form===n.form&&un(c)}break t;case"textarea":_i(n,r.value,r.defaultValue);break t;case"select":i=r.value,i!=null&&Dn(n,!!r.multiple,i,!1)}}}var Rf=!1;function pg(n,i,r){if(Rf)return n(i,r);Rf=!0;try{var c=n(i);return c}finally{if(Rf=!1,(Rr!==null||Cr!==null)&&(au(),Rr&&(i=Rr,n=Cr,Cr=Rr=null,dg(i),n)))for(i=0;i<n.length;i++)dg(n[i])}}function Ko(n,i){var r=n.stateNode;if(r===null)return null;var c=r[zn]||null;if(c===null)return null;r=c[i];t:switch(i){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(c=!c.disabled)||(n=n.type,c=!(n==="button"||n==="input"||n==="select"||n==="textarea")),n=!c;break t;default:n=!1}if(n)return null;if(r&&typeof r!="function")throw Error(a(231,i,typeof r));return r}var Sa=!(typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"),Cf=!1;if(Sa)try{var Jo={};Object.defineProperty(Jo,"passive",{get:function(){Cf=!0}}),window.addEventListener("test",Jo,Jo),window.removeEventListener("test",Jo,Jo)}catch{Cf=!1}var ss=null,Df=null,_c=null;function mg(){if(_c)return _c;var n,i=Df,r=i.length,c,f="value"in ss?ss.value:ss.textContent,m=f.length;for(n=0;n<r&&i[n]===f[n];n++);var S=r-n;for(c=1;c<=S&&i[r-c]===f[m-c];c++);return _c=f.slice(n,1<c?1-c:void 0)}function xc(n){var i=n.keyCode;return"charCode"in n?(n=n.charCode,n===0&&i===13&&(n=13)):n=i,n===10&&(n=13),32<=n||n===13?n:0}function yc(){return!0}function gg(){return!1}function ui(n){function i(r,c,f,m,S){this._reactName=r,this._targetInst=f,this.type=c,this.nativeEvent=m,this.target=S,this.currentTarget=null;for(var R in n)n.hasOwnProperty(R)&&(r=n[R],this[R]=r?r(m):m[R]);return this.isDefaultPrevented=(m.defaultPrevented!=null?m.defaultPrevented:m.returnValue===!1)?yc:gg,this.isPropagationStopped=gg,this}return _(i.prototype,{preventDefault:function(){this.defaultPrevented=!0;var r=this.nativeEvent;r&&(r.preventDefault?r.preventDefault():typeof r.returnValue!="unknown"&&(r.returnValue=!1),this.isDefaultPrevented=yc)},stopPropagation:function(){var r=this.nativeEvent;r&&(r.stopPropagation?r.stopPropagation():typeof r.cancelBubble!="unknown"&&(r.cancelBubble=!0),this.isPropagationStopped=yc)},persist:function(){},isPersistent:yc}),i}var qs={eventPhase:0,bubbles:0,cancelable:0,timeStamp:function(n){return n.timeStamp||Date.now()},defaultPrevented:0,isTrusted:0},Sc=ui(qs),Qo=_({},qs,{view:0,detail:0}),OS=ui(Qo),Uf,Lf,$o,Mc=_({},Qo,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:Of,button:0,buttons:0,relatedTarget:function(n){return n.relatedTarget===void 0?n.fromElement===n.srcElement?n.toElement:n.fromElement:n.relatedTarget},movementX:function(n){return"movementX"in n?n.movementX:(n!==$o&&($o&&n.type==="mousemove"?(Uf=n.screenX-$o.screenX,Lf=n.screenY-$o.screenY):Lf=Uf=0,$o=n),Uf)},movementY:function(n){return"movementY"in n?n.movementY:Lf}}),vg=ui(Mc),PS=_({},Mc,{dataTransfer:0}),BS=ui(PS),IS=_({},Qo,{relatedTarget:0}),Nf=ui(IS),zS=_({},qs,{animationName:0,elapsedTime:0,pseudoElement:0}),FS=ui(zS),HS=_({},qs,{clipboardData:function(n){return"clipboardData"in n?n.clipboardData:window.clipboardData}}),GS=ui(HS),VS=_({},qs,{data:0}),_g=ui(VS),kS={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},XS={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},WS={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"};function qS(n){var i=this.nativeEvent;return i.getModifierState?i.getModifierState(n):(n=WS[n])?!!i[n]:!1}function Of(){return qS}var YS=_({},Qo,{key:function(n){if(n.key){var i=kS[n.key]||n.key;if(i!=="Unidentified")return i}return n.type==="keypress"?(n=xc(n),n===13?"Enter":String.fromCharCode(n)):n.type==="keydown"||n.type==="keyup"?XS[n.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:Of,charCode:function(n){return n.type==="keypress"?xc(n):0},keyCode:function(n){return n.type==="keydown"||n.type==="keyup"?n.keyCode:0},which:function(n){return n.type==="keypress"?xc(n):n.type==="keydown"||n.type==="keyup"?n.keyCode:0}}),ZS=ui(YS),KS=_({},Mc,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0}),xg=ui(KS),JS=_({},Qo,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:Of}),QS=ui(JS),$S=_({},qs,{propertyName:0,elapsedTime:0,pseudoElement:0}),jS=ui($S),tM=_({},Mc,{deltaX:function(n){return"deltaX"in n?n.deltaX:"wheelDeltaX"in n?-n.wheelDeltaX:0},deltaY:function(n){return"deltaY"in n?n.deltaY:"wheelDeltaY"in n?-n.wheelDeltaY:"wheelDelta"in n?-n.wheelDelta:0},deltaZ:0,deltaMode:0}),eM=ui(tM),nM=_({},qs,{newState:0,oldState:0}),iM=ui(nM),aM=[9,13,27,32],Pf=Sa&&"CompositionEvent"in window,jo=null;Sa&&"documentMode"in document&&(jo=document.documentMode);var sM=Sa&&"TextEvent"in window&&!jo,yg=Sa&&(!Pf||jo&&8<jo&&11>=jo),Sg=" ",Mg=!1;function bg(n,i){switch(n){case"keyup":return aM.indexOf(i.keyCode)!==-1;case"keydown":return i.keyCode!==229;case"keypress":case"mousedown":case"focusout":return!0;default:return!1}}function Eg(n){return n=n.detail,typeof n=="object"&&"data"in n?n.data:null}var Dr=!1;function rM(n,i){switch(n){case"compositionend":return Eg(i);case"keypress":return i.which!==32?null:(Mg=!0,Sg);case"textInput":return n=i.data,n===Sg&&Mg?null:n;default:return null}}function oM(n,i){if(Dr)return n==="compositionend"||!Pf&&bg(n,i)?(n=mg(),_c=Df=ss=null,Dr=!1,n):null;switch(n){case"paste":return null;case"keypress":if(!(i.ctrlKey||i.altKey||i.metaKey)||i.ctrlKey&&i.altKey){if(i.char&&1<i.char.length)return i.char;if(i.which)return String.fromCharCode(i.which)}return null;case"compositionend":return yg&&i.locale!=="ko"?null:i.data;default:return null}}var lM={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0};function Tg(n){var i=n&&n.nodeName&&n.nodeName.toLowerCase();return i==="input"?!!lM[n.type]:i==="textarea"}function Ag(n,i,r,c){Rr?Cr?Cr.push(c):Cr=[c]:Rr=c,i=fu(i,"onChange"),0<i.length&&(r=new Sc("onChange","change",null,r,c),n.push({event:r,listeners:i}))}var tl=null,el=null;function cM(n){l_(n,0)}function bc(n){var i=Xs(n);if(un(i))return n}function wg(n,i){if(n==="change")return i}var Rg=!1;if(Sa){var Bf;if(Sa){var If="oninput"in document;if(!If){var Cg=document.createElement("div");Cg.setAttribute("oninput","return;"),If=typeof Cg.oninput=="function"}Bf=If}else Bf=!1;Rg=Bf&&(!document.documentMode||9<document.documentMode)}function Dg(){tl&&(tl.detachEvent("onpropertychange",Ug),el=tl=null)}function Ug(n){if(n.propertyName==="value"&&bc(el)){var i=[];Ag(i,el,n,wf(n)),pg(cM,i)}}function uM(n,i,r){n==="focusin"?(Dg(),tl=i,el=r,tl.attachEvent("onpropertychange",Ug)):n==="focusout"&&Dg()}function fM(n){if(n==="selectionchange"||n==="keyup"||n==="keydown")return bc(el)}function hM(n,i){if(n==="click")return bc(i)}function dM(n,i){if(n==="input"||n==="change")return bc(i)}function pM(n,i){return n===i&&(n!==0||1/n===1/i)||n!==n&&i!==i}var yi=typeof Object.is=="function"?Object.is:pM;function nl(n,i){if(yi(n,i))return!0;if(typeof n!="object"||n===null||typeof i!="object"||i===null)return!1;var r=Object.keys(n),c=Object.keys(i);if(r.length!==c.length)return!1;for(c=0;c<r.length;c++){var f=r[c];if(!le.call(i,f)||!yi(n[f],i[f]))return!1}return!0}function Lg(n){for(;n&&n.firstChild;)n=n.firstChild;return n}function Ng(n,i){var r=Lg(n);n=0;for(var c;r;){if(r.nodeType===3){if(c=n+r.textContent.length,n<=i&&c>=i)return{node:r,offset:i-n};n=c}t:{for(;r;){if(r.nextSibling){r=r.nextSibling;break t}r=r.parentNode}r=void 0}r=Lg(r)}}function Og(n,i){return n&&i?n===i?!0:n&&n.nodeType===3?!1:i&&i.nodeType===3?Og(n,i.parentNode):"contains"in n?n.contains(i):n.compareDocumentPosition?!!(n.compareDocumentPosition(i)&16):!1:!1}function Pg(n){n=n!=null&&n.ownerDocument!=null&&n.ownerDocument.defaultView!=null?n.ownerDocument.defaultView:window;for(var i=nn(n.document);i instanceof n.HTMLIFrameElement;){try{var r=typeof i.contentWindow.location.href=="string"}catch{r=!1}if(r)n=i.contentWindow;else break;i=nn(n.document)}return i}function zf(n){var i=n&&n.nodeName&&n.nodeName.toLowerCase();return i&&(i==="input"&&(n.type==="text"||n.type==="search"||n.type==="tel"||n.type==="url"||n.type==="password")||i==="textarea"||n.contentEditable==="true")}var mM=Sa&&"documentMode"in document&&11>=document.documentMode,Ur=null,Ff=null,il=null,Hf=!1;function Bg(n,i,r){var c=r.window===r?r.document:r.nodeType===9?r:r.ownerDocument;Hf||Ur==null||Ur!==nn(c)||(c=Ur,"selectionStart"in c&&zf(c)?c={start:c.selectionStart,end:c.selectionEnd}:(c=(c.ownerDocument&&c.ownerDocument.defaultView||window).getSelection(),c={anchorNode:c.anchorNode,anchorOffset:c.anchorOffset,focusNode:c.focusNode,focusOffset:c.focusOffset}),il&&nl(il,c)||(il=c,c=fu(Ff,"onSelect"),0<c.length&&(i=new Sc("onSelect","select",null,i,r),n.push({event:i,listeners:c}),i.target=Ur)))}function Ys(n,i){var r={};return r[n.toLowerCase()]=i.toLowerCase(),r["Webkit"+n]="webkit"+i,r["Moz"+n]="moz"+i,r}var Lr={animationend:Ys("Animation","AnimationEnd"),animationiteration:Ys("Animation","AnimationIteration"),animationstart:Ys("Animation","AnimationStart"),transitionrun:Ys("Transition","TransitionRun"),transitionstart:Ys("Transition","TransitionStart"),transitioncancel:Ys("Transition","TransitionCancel"),transitionend:Ys("Transition","TransitionEnd")},Gf={},Ig={};Sa&&(Ig=document.createElement("div").style,"AnimationEvent"in window||(delete Lr.animationend.animation,delete Lr.animationiteration.animation,delete Lr.animationstart.animation),"TransitionEvent"in window||delete Lr.transitionend.transition);function Zs(n){if(Gf[n])return Gf[n];if(!Lr[n])return n;var i=Lr[n],r;for(r in i)if(i.hasOwnProperty(r)&&r in Ig)return Gf[n]=i[r];return n}var zg=Zs("animationend"),Fg=Zs("animationiteration"),Hg=Zs("animationstart"),gM=Zs("transitionrun"),vM=Zs("transitionstart"),_M=Zs("transitioncancel"),Gg=Zs("transitionend"),Vg=new Map,Vf="abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");Vf.push("scrollEnd");function qi(n,i){Vg.set(n,i),Q(i,[n])}var Ec=typeof reportError=="function"?reportError:function(n){if(typeof window=="object"&&typeof window.ErrorEvent=="function"){var i=new window.ErrorEvent("error",{bubbles:!0,cancelable:!0,message:typeof n=="object"&&n!==null&&typeof n.message=="string"?String(n.message):String(n),error:n});if(!window.dispatchEvent(i))return}else if(typeof process=="object"&&typeof process.emit=="function"){process.emit("uncaughtException",n);return}console.error(n)},Li=[],Nr=0,kf=0;function Tc(){for(var n=Nr,i=kf=Nr=0;i<n;){var r=Li[i];Li[i++]=null;var c=Li[i];Li[i++]=null;var f=Li[i];Li[i++]=null;var m=Li[i];if(Li[i++]=null,c!==null&&f!==null){var S=c.pending;S===null?f.next=f:(f.next=S.next,S.next=f),c.pending=f}m!==0&&kg(r,f,m)}}function Ac(n,i,r,c){Li[Nr++]=n,Li[Nr++]=i,Li[Nr++]=r,Li[Nr++]=c,kf|=c,n.lanes|=c,n=n.alternate,n!==null&&(n.lanes|=c)}function Xf(n,i,r,c){return Ac(n,i,r,c),wc(n)}function Ks(n,i){return Ac(n,null,null,i),wc(n)}function kg(n,i,r){n.lanes|=r;var c=n.alternate;c!==null&&(c.lanes|=r);for(var f=!1,m=n.return;m!==null;)m.childLanes|=r,c=m.alternate,c!==null&&(c.childLanes|=r),m.tag===22&&(n=m.stateNode,n===null||n._visibility&1||(f=!0)),n=m,m=m.return;return n.tag===3?(m=n.stateNode,f&&i!==null&&(f=31-Yt(r),n=m.hiddenUpdates,c=n[f],c===null?n[f]=[i]:c.push(i),i.lane=r|536870912),m):null}function wc(n){if(50<Tl)throw Tl=0,jh=null,Error(a(185));for(var i=n.return;i!==null;)n=i,i=n.return;return n.tag===3?n.stateNode:null}var Or={};function xM(n,i,r,c){this.tag=n,this.key=r,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.refCleanup=this.ref=null,this.pendingProps=i,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=c,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Si(n,i,r,c){return new xM(n,i,r,c)}function Wf(n){return n=n.prototype,!(!n||!n.isReactComponent)}function Ma(n,i){var r=n.alternate;return r===null?(r=Si(n.tag,i,n.key,n.mode),r.elementType=n.elementType,r.type=n.type,r.stateNode=n.stateNode,r.alternate=n,n.alternate=r):(r.pendingProps=i,r.type=n.type,r.flags=0,r.subtreeFlags=0,r.deletions=null),r.flags=n.flags&65011712,r.childLanes=n.childLanes,r.lanes=n.lanes,r.child=n.child,r.memoizedProps=n.memoizedProps,r.memoizedState=n.memoizedState,r.updateQueue=n.updateQueue,i=n.dependencies,r.dependencies=i===null?null:{lanes:i.lanes,firstContext:i.firstContext},r.sibling=n.sibling,r.index=n.index,r.ref=n.ref,r.refCleanup=n.refCleanup,r}function Xg(n,i){n.flags&=65011714;var r=n.alternate;return r===null?(n.childLanes=0,n.lanes=i,n.child=null,n.subtreeFlags=0,n.memoizedProps=null,n.memoizedState=null,n.updateQueue=null,n.dependencies=null,n.stateNode=null):(n.childLanes=r.childLanes,n.lanes=r.lanes,n.child=r.child,n.subtreeFlags=0,n.deletions=null,n.memoizedProps=r.memoizedProps,n.memoizedState=r.memoizedState,n.updateQueue=r.updateQueue,n.type=r.type,i=r.dependencies,n.dependencies=i===null?null:{lanes:i.lanes,firstContext:i.firstContext}),n}function Rc(n,i,r,c,f,m){var S=0;if(c=n,typeof n=="function")Wf(n)&&(S=1);else if(typeof n=="string")S=Eb(n,r,Ct.current)?26:n==="html"||n==="head"||n==="body"?27:5;else t:switch(n){case P:return n=Si(31,r,i,f),n.elementType=P,n.lanes=m,n;case C:return Js(r.children,f,m,i);case M:S=8,f|=24;break;case y:return n=Si(12,r,i,f|2),n.elementType=y,n.lanes=m,n;case O:return n=Si(13,r,i,f),n.elementType=O,n.lanes=m,n;case U:return n=Si(19,r,i,f),n.elementType=U,n.lanes=m,n;default:if(typeof n=="object"&&n!==null)switch(n.$$typeof){case D:S=10;break t;case I:S=9;break t;case A:S=11;break t;case z:S=14;break t;case T:S=16,c=null;break t}S=29,r=Error(a(130,n===null?"null":typeof n,"")),c=null}return i=Si(S,r,i,f),i.elementType=n,i.type=c,i.lanes=m,i}function Js(n,i,r,c){return n=Si(7,n,c,i),n.lanes=r,n}function qf(n,i,r){return n=Si(6,n,null,i),n.lanes=r,n}function Wg(n){var i=Si(18,null,null,0);return i.stateNode=n,i}function Yf(n,i,r){return i=Si(4,n.children!==null?n.children:[],n.key,i),i.lanes=r,i.stateNode={containerInfo:n.containerInfo,pendingChildren:null,implementation:n.implementation},i}var qg=new WeakMap;function Ni(n,i){if(typeof n=="object"&&n!==null){var r=qg.get(n);return r!==void 0?r:(i={value:n,source:i,stack:Gt(i)},qg.set(n,i),i)}return{value:n,source:i,stack:Gt(i)}}var Pr=[],Br=0,Cc=null,al=0,Oi=[],Pi=0,rs=null,aa=1,sa="";function ba(n,i){Pr[Br++]=al,Pr[Br++]=Cc,Cc=n,al=i}function Yg(n,i,r){Oi[Pi++]=aa,Oi[Pi++]=sa,Oi[Pi++]=rs,rs=n;var c=aa;n=sa;var f=32-Yt(c)-1;c&=~(1<<f),r+=1;var m=32-Yt(i)+f;if(30<m){var S=f-f%5;m=(c&(1<<S)-1).toString(32),c>>=S,f-=S,aa=1<<32-Yt(i)+f|r<<f|c,sa=m+n}else aa=1<<m|r<<f|c,sa=n}function Zf(n){n.return!==null&&(ba(n,1),Yg(n,1,0))}function Kf(n){for(;n===Cc;)Cc=Pr[--Br],Pr[Br]=null,al=Pr[--Br],Pr[Br]=null;for(;n===rs;)rs=Oi[--Pi],Oi[Pi]=null,sa=Oi[--Pi],Oi[Pi]=null,aa=Oi[--Pi],Oi[Pi]=null}function Zg(n,i){Oi[Pi++]=aa,Oi[Pi++]=sa,Oi[Pi++]=rs,aa=i.id,sa=i.overflow,rs=n}var Fn=null,on=null,Be=!1,os=null,Bi=!1,Jf=Error(a(519));function ls(n){var i=Error(a(418,1<arguments.length&&arguments[1]!==void 0&&arguments[1]?"text":"HTML",""));throw sl(Ni(i,n)),Jf}function Kg(n){var i=n.stateNode,r=n.type,c=n.memoizedProps;switch(i[Mn]=n,i[zn]=c,r){case"dialog":De("cancel",i),De("close",i);break;case"iframe":case"object":case"embed":De("load",i);break;case"video":case"audio":for(r=0;r<wl.length;r++)De(wl[r],i);break;case"source":De("error",i);break;case"img":case"image":case"link":De("error",i),De("load",i);break;case"details":De("toggle",i);break;case"input":De("invalid",i),Zn(i,c.value,c.defaultValue,c.checked,c.defaultChecked,c.type,c.name,!0);break;case"select":De("invalid",i);break;case"textarea":De("invalid",i),Xi(i,c.value,c.defaultValue,c.children)}r=c.children,typeof r!="string"&&typeof r!="number"&&typeof r!="bigint"||i.textContent===""+r||c.suppressHydrationWarning===!0||h_(i.textContent,r)?(c.popover!=null&&(De("beforetoggle",i),De("toggle",i)),c.onScroll!=null&&De("scroll",i),c.onScrollEnd!=null&&De("scrollend",i),c.onClick!=null&&(i.onclick=ya),i=!0):i=!1,i||ls(n,!0)}function Jg(n){for(Fn=n.return;Fn;)switch(Fn.tag){case 5:case 31:case 13:Bi=!1;return;case 27:case 3:Bi=!0;return;default:Fn=Fn.return}}function Ir(n){if(n!==Fn)return!1;if(!Be)return Jg(n),Be=!0,!1;var i=n.tag,r;if((r=i!==3&&i!==27)&&((r=i===5)&&(r=n.type,r=!(r!=="form"&&r!=="button")||pd(n.type,n.memoizedProps)),r=!r),r&&on&&ls(n),Jg(n),i===13){if(n=n.memoizedState,n=n!==null?n.dehydrated:null,!n)throw Error(a(317));on=S_(n)}else if(i===31){if(n=n.memoizedState,n=n!==null?n.dehydrated:null,!n)throw Error(a(317));on=S_(n)}else i===27?(i=on,Ms(n.type)?(n=xd,xd=null,on=n):on=i):on=Fn?zi(n.stateNode.nextSibling):null;return!0}function Qs(){on=Fn=null,Be=!1}function Qf(){var n=os;return n!==null&&(pi===null?pi=n:pi.push.apply(pi,n),os=null),n}function sl(n){os===null?os=[n]:os.push(n)}var $f=L(null),$s=null,Ea=null;function cs(n,i,r){_t($f,i._currentValue),i._currentValue=r}function Ta(n){n._currentValue=$f.current,X($f)}function jf(n,i,r){for(;n!==null;){var c=n.alternate;if((n.childLanes&i)!==i?(n.childLanes|=i,c!==null&&(c.childLanes|=i)):c!==null&&(c.childLanes&i)!==i&&(c.childLanes|=i),n===r)break;n=n.return}}function th(n,i,r,c){var f=n.child;for(f!==null&&(f.return=n);f!==null;){var m=f.dependencies;if(m!==null){var S=f.child;m=m.firstContext;t:for(;m!==null;){var R=m;m=f;for(var G=0;G<i.length;G++)if(R.context===i[G]){m.lanes|=r,R=m.alternate,R!==null&&(R.lanes|=r),jf(m.return,r,n),c||(S=null);break t}m=R.next}}else if(f.tag===18){if(S=f.return,S===null)throw Error(a(341));S.lanes|=r,m=S.alternate,m!==null&&(m.lanes|=r),jf(S,r,n),S=null}else S=f.child;if(S!==null)S.return=f;else for(S=f;S!==null;){if(S===n){S=null;break}if(f=S.sibling,f!==null){f.return=S.return,S=f;break}S=S.return}f=S}}function zr(n,i,r,c){n=null;for(var f=i,m=!1;f!==null;){if(!m){if((f.flags&524288)!==0)m=!0;else if((f.flags&262144)!==0)break}if(f.tag===10){var S=f.alternate;if(S===null)throw Error(a(387));if(S=S.memoizedProps,S!==null){var R=f.type;yi(f.pendingProps.value,S.value)||(n!==null?n.push(R):n=[R])}}else if(f===Mt.current){if(S=f.alternate,S===null)throw Error(a(387));S.memoizedState.memoizedState!==f.memoizedState.memoizedState&&(n!==null?n.push(Ll):n=[Ll])}f=f.return}n!==null&&th(i,n,r,c),i.flags|=262144}function Dc(n){for(n=n.firstContext;n!==null;){if(!yi(n.context._currentValue,n.memoizedValue))return!0;n=n.next}return!1}function js(n){$s=n,Ea=null,n=n.dependencies,n!==null&&(n.firstContext=null)}function Hn(n){return Qg($s,n)}function Uc(n,i){return $s===null&&js(n),Qg(n,i)}function Qg(n,i){var r=i._currentValue;if(i={context:i,memoizedValue:r,next:null},Ea===null){if(n===null)throw Error(a(308));Ea=i,n.dependencies={lanes:0,firstContext:i},n.flags|=524288}else Ea=Ea.next=i;return r}var yM=typeof AbortController<"u"?AbortController:function(){var n=[],i=this.signal={aborted:!1,addEventListener:function(r,c){n.push(c)}};this.abort=function(){i.aborted=!0,n.forEach(function(r){return r()})}},SM=s.unstable_scheduleCallback,MM=s.unstable_NormalPriority,En={$$typeof:D,Consumer:null,Provider:null,_currentValue:null,_currentValue2:null,_threadCount:0};function eh(){return{controller:new yM,data:new Map,refCount:0}}function rl(n){n.refCount--,n.refCount===0&&SM(MM,function(){n.controller.abort()})}var ol=null,nh=0,Fr=0,Hr=null;function bM(n,i){if(ol===null){var r=ol=[];nh=0,Fr=sd(),Hr={status:"pending",value:void 0,then:function(c){r.push(c)}}}return nh++,i.then($g,$g),i}function $g(){if(--nh===0&&ol!==null){Hr!==null&&(Hr.status="fulfilled");var n=ol;ol=null,Fr=0,Hr=null;for(var i=0;i<n.length;i++)(0,n[i])()}}function EM(n,i){var r=[],c={status:"pending",value:null,reason:null,then:function(f){r.push(f)}};return n.then(function(){c.status="fulfilled",c.value=i;for(var f=0;f<r.length;f++)(0,r[f])(i)},function(f){for(c.status="rejected",c.reason=f,f=0;f<r.length;f++)(0,r[f])(void 0)}),c}var jg=F.S;F.S=function(n,i){Bv=Me(),typeof i=="object"&&i!==null&&typeof i.then=="function"&&bM(n,i),jg!==null&&jg(n,i)};var tr=L(null);function ih(){var n=tr.current;return n!==null?n:an.pooledCache}function Lc(n,i){i===null?_t(tr,tr.current):_t(tr,i.pool)}function t0(){var n=ih();return n===null?null:{parent:En._currentValue,pool:n}}var Gr=Error(a(460)),ah=Error(a(474)),Nc=Error(a(542)),Oc={then:function(){}};function e0(n){return n=n.status,n==="fulfilled"||n==="rejected"}function n0(n,i,r){switch(r=n[r],r===void 0?n.push(i):r!==i&&(i.then(ya,ya),i=r),i.status){case"fulfilled":return i.value;case"rejected":throw n=i.reason,a0(n),n;default:if(typeof i.status=="string")i.then(ya,ya);else{if(n=an,n!==null&&100<n.shellSuspendCounter)throw Error(a(482));n=i,n.status="pending",n.then(function(c){if(i.status==="pending"){var f=i;f.status="fulfilled",f.value=c}},function(c){if(i.status==="pending"){var f=i;f.status="rejected",f.reason=c}})}switch(i.status){case"fulfilled":return i.value;case"rejected":throw n=i.reason,a0(n),n}throw nr=i,Gr}}function er(n){try{var i=n._init;return i(n._payload)}catch(r){throw r!==null&&typeof r=="object"&&typeof r.then=="function"?(nr=r,Gr):r}}var nr=null;function i0(){if(nr===null)throw Error(a(459));var n=nr;return nr=null,n}function a0(n){if(n===Gr||n===Nc)throw Error(a(483))}var Vr=null,ll=0;function Pc(n){var i=ll;return ll+=1,Vr===null&&(Vr=[]),n0(Vr,n,i)}function cl(n,i){i=i.props.ref,n.ref=i!==void 0?i:null}function Bc(n,i){throw i.$$typeof===v?Error(a(525)):(n=Object.prototype.toString.call(i),Error(a(31,n==="[object Object]"?"object with keys {"+Object.keys(i).join(", ")+"}":n)))}function s0(n){function i(j,Y){if(n){var it=j.deletions;it===null?(j.deletions=[Y],j.flags|=16):it.push(Y)}}function r(j,Y){if(!n)return null;for(;Y!==null;)i(j,Y),Y=Y.sibling;return null}function c(j){for(var Y=new Map;j!==null;)j.key!==null?Y.set(j.key,j):Y.set(j.index,j),j=j.sibling;return Y}function f(j,Y){return j=Ma(j,Y),j.index=0,j.sibling=null,j}function m(j,Y,it){return j.index=it,n?(it=j.alternate,it!==null?(it=it.index,it<Y?(j.flags|=67108866,Y):it):(j.flags|=67108866,Y)):(j.flags|=1048576,Y)}function S(j){return n&&j.alternate===null&&(j.flags|=67108866),j}function R(j,Y,it,St){return Y===null||Y.tag!==6?(Y=qf(it,j.mode,St),Y.return=j,Y):(Y=f(Y,it),Y.return=j,Y)}function G(j,Y,it,St){var fe=it.type;return fe===C?xt(j,Y,it.props.children,St,it.key):Y!==null&&(Y.elementType===fe||typeof fe=="object"&&fe!==null&&fe.$$typeof===T&&er(fe)===Y.type)?(Y=f(Y,it.props),cl(Y,it),Y.return=j,Y):(Y=Rc(it.type,it.key,it.props,null,j.mode,St),cl(Y,it),Y.return=j,Y)}function at(j,Y,it,St){return Y===null||Y.tag!==4||Y.stateNode.containerInfo!==it.containerInfo||Y.stateNode.implementation!==it.implementation?(Y=Yf(it,j.mode,St),Y.return=j,Y):(Y=f(Y,it.children||[]),Y.return=j,Y)}function xt(j,Y,it,St,fe){return Y===null||Y.tag!==7?(Y=Js(it,j.mode,St,fe),Y.return=j,Y):(Y=f(Y,it),Y.return=j,Y)}function bt(j,Y,it){if(typeof Y=="string"&&Y!==""||typeof Y=="number"||typeof Y=="bigint")return Y=qf(""+Y,j.mode,it),Y.return=j,Y;if(typeof Y=="object"&&Y!==null){switch(Y.$$typeof){case x:return it=Rc(Y.type,Y.key,Y.props,null,j.mode,it),cl(it,Y),it.return=j,it;case b:return Y=Yf(Y,j.mode,it),Y.return=j,Y;case T:return Y=er(Y),bt(j,Y,it)}if(J(Y)||K(Y))return Y=Js(Y,j.mode,it,null),Y.return=j,Y;if(typeof Y.then=="function")return bt(j,Pc(Y),it);if(Y.$$typeof===D)return bt(j,Uc(j,Y),it);Bc(j,Y)}return null}function ct(j,Y,it,St){var fe=Y!==null?Y.key:null;if(typeof it=="string"&&it!==""||typeof it=="number"||typeof it=="bigint")return fe!==null?null:R(j,Y,""+it,St);if(typeof it=="object"&&it!==null){switch(it.$$typeof){case x:return it.key===fe?G(j,Y,it,St):null;case b:return it.key===fe?at(j,Y,it,St):null;case T:return it=er(it),ct(j,Y,it,St)}if(J(it)||K(it))return fe!==null?null:xt(j,Y,it,St,null);if(typeof it.then=="function")return ct(j,Y,Pc(it),St);if(it.$$typeof===D)return ct(j,Y,Uc(j,it),St);Bc(j,it)}return null}function ht(j,Y,it,St,fe){if(typeof St=="string"&&St!==""||typeof St=="number"||typeof St=="bigint")return j=j.get(it)||null,R(Y,j,""+St,fe);if(typeof St=="object"&&St!==null){switch(St.$$typeof){case x:return j=j.get(St.key===null?it:St.key)||null,G(Y,j,St,fe);case b:return j=j.get(St.key===null?it:St.key)||null,at(Y,j,St,fe);case T:return St=er(St),ht(j,Y,it,St,fe)}if(J(St)||K(St))return j=j.get(it)||null,xt(Y,j,St,fe,null);if(typeof St.then=="function")return ht(j,Y,it,Pc(St),fe);if(St.$$typeof===D)return ht(j,Y,it,Uc(Y,St),fe);Bc(Y,St)}return null}function te(j,Y,it,St){for(var fe=null,Fe=null,ie=Y,Te=Y=0,Ne=null;ie!==null&&Te<it.length;Te++){ie.index>Te?(Ne=ie,ie=null):Ne=ie.sibling;var He=ct(j,ie,it[Te],St);if(He===null){ie===null&&(ie=Ne);break}n&&ie&&He.alternate===null&&i(j,ie),Y=m(He,Y,Te),Fe===null?fe=He:Fe.sibling=He,Fe=He,ie=Ne}if(Te===it.length)return r(j,ie),Be&&ba(j,Te),fe;if(ie===null){for(;Te<it.length;Te++)ie=bt(j,it[Te],St),ie!==null&&(Y=m(ie,Y,Te),Fe===null?fe=ie:Fe.sibling=ie,Fe=ie);return Be&&ba(j,Te),fe}for(ie=c(ie);Te<it.length;Te++)Ne=ht(ie,j,Te,it[Te],St),Ne!==null&&(n&&Ne.alternate!==null&&ie.delete(Ne.key===null?Te:Ne.key),Y=m(Ne,Y,Te),Fe===null?fe=Ne:Fe.sibling=Ne,Fe=Ne);return n&&ie.forEach(function(ws){return i(j,ws)}),Be&&ba(j,Te),fe}function de(j,Y,it,St){if(it==null)throw Error(a(151));for(var fe=null,Fe=null,ie=Y,Te=Y=0,Ne=null,He=it.next();ie!==null&&!He.done;Te++,He=it.next()){ie.index>Te?(Ne=ie,ie=null):Ne=ie.sibling;var ws=ct(j,ie,He.value,St);if(ws===null){ie===null&&(ie=Ne);break}n&&ie&&ws.alternate===null&&i(j,ie),Y=m(ws,Y,Te),Fe===null?fe=ws:Fe.sibling=ws,Fe=ws,ie=Ne}if(He.done)return r(j,ie),Be&&ba(j,Te),fe;if(ie===null){for(;!He.done;Te++,He=it.next())He=bt(j,He.value,St),He!==null&&(Y=m(He,Y,Te),Fe===null?fe=He:Fe.sibling=He,Fe=He);return Be&&ba(j,Te),fe}for(ie=c(ie);!He.done;Te++,He=it.next())He=ht(ie,j,Te,He.value,St),He!==null&&(n&&He.alternate!==null&&ie.delete(He.key===null?Te:He.key),Y=m(He,Y,Te),Fe===null?fe=He:Fe.sibling=He,Fe=He);return n&&ie.forEach(function(Pb){return i(j,Pb)}),Be&&ba(j,Te),fe}function je(j,Y,it,St){if(typeof it=="object"&&it!==null&&it.type===C&&it.key===null&&(it=it.props.children),typeof it=="object"&&it!==null){switch(it.$$typeof){case x:t:{for(var fe=it.key;Y!==null;){if(Y.key===fe){if(fe=it.type,fe===C){if(Y.tag===7){r(j,Y.sibling),St=f(Y,it.props.children),St.return=j,j=St;break t}}else if(Y.elementType===fe||typeof fe=="object"&&fe!==null&&fe.$$typeof===T&&er(fe)===Y.type){r(j,Y.sibling),St=f(Y,it.props),cl(St,it),St.return=j,j=St;break t}r(j,Y);break}else i(j,Y);Y=Y.sibling}it.type===C?(St=Js(it.props.children,j.mode,St,it.key),St.return=j,j=St):(St=Rc(it.type,it.key,it.props,null,j.mode,St),cl(St,it),St.return=j,j=St)}return S(j);case b:t:{for(fe=it.key;Y!==null;){if(Y.key===fe)if(Y.tag===4&&Y.stateNode.containerInfo===it.containerInfo&&Y.stateNode.implementation===it.implementation){r(j,Y.sibling),St=f(Y,it.children||[]),St.return=j,j=St;break t}else{r(j,Y);break}else i(j,Y);Y=Y.sibling}St=Yf(it,j.mode,St),St.return=j,j=St}return S(j);case T:return it=er(it),je(j,Y,it,St)}if(J(it))return te(j,Y,it,St);if(K(it)){if(fe=K(it),typeof fe!="function")throw Error(a(150));return it=fe.call(it),de(j,Y,it,St)}if(typeof it.then=="function")return je(j,Y,Pc(it),St);if(it.$$typeof===D)return je(j,Y,Uc(j,it),St);Bc(j,it)}return typeof it=="string"&&it!==""||typeof it=="number"||typeof it=="bigint"?(it=""+it,Y!==null&&Y.tag===6?(r(j,Y.sibling),St=f(Y,it),St.return=j,j=St):(r(j,Y),St=qf(it,j.mode,St),St.return=j,j=St),S(j)):r(j,Y)}return function(j,Y,it,St){try{ll=0;var fe=je(j,Y,it,St);return Vr=null,fe}catch(ie){if(ie===Gr||ie===Nc)throw ie;var Fe=Si(29,ie,null,j.mode);return Fe.lanes=St,Fe.return=j,Fe}}}var ir=s0(!0),r0=s0(!1),us=!1;function sh(n){n.updateQueue={baseState:n.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,lanes:0,hiddenCallbacks:null},callbacks:null}}function rh(n,i){n=n.updateQueue,i.updateQueue===n&&(i.updateQueue={baseState:n.baseState,firstBaseUpdate:n.firstBaseUpdate,lastBaseUpdate:n.lastBaseUpdate,shared:n.shared,callbacks:null})}function fs(n){return{lane:n,tag:0,payload:null,callback:null,next:null}}function hs(n,i,r){var c=n.updateQueue;if(c===null)return null;if(c=c.shared,(Ve&2)!==0){var f=c.pending;return f===null?i.next=i:(i.next=f.next,f.next=i),c.pending=i,i=wc(n),kg(n,null,r),i}return Ac(n,c,i,r),wc(n)}function ul(n,i,r){if(i=i.updateQueue,i!==null&&(i=i.shared,(r&4194048)!==0)){var c=i.lanes;c&=n.pendingLanes,r|=c,i.lanes=r,gi(n,r)}}function oh(n,i){var r=n.updateQueue,c=n.alternate;if(c!==null&&(c=c.updateQueue,r===c)){var f=null,m=null;if(r=r.firstBaseUpdate,r!==null){do{var S={lane:r.lane,tag:r.tag,payload:r.payload,callback:null,next:null};m===null?f=m=S:m=m.next=S,r=r.next}while(r!==null);m===null?f=m=i:m=m.next=i}else f=m=i;r={baseState:c.baseState,firstBaseUpdate:f,lastBaseUpdate:m,shared:c.shared,callbacks:c.callbacks},n.updateQueue=r;return}n=r.lastBaseUpdate,n===null?r.firstBaseUpdate=i:n.next=i,r.lastBaseUpdate=i}var lh=!1;function fl(){if(lh){var n=Hr;if(n!==null)throw n}}function hl(n,i,r,c){lh=!1;var f=n.updateQueue;us=!1;var m=f.firstBaseUpdate,S=f.lastBaseUpdate,R=f.shared.pending;if(R!==null){f.shared.pending=null;var G=R,at=G.next;G.next=null,S===null?m=at:S.next=at,S=G;var xt=n.alternate;xt!==null&&(xt=xt.updateQueue,R=xt.lastBaseUpdate,R!==S&&(R===null?xt.firstBaseUpdate=at:R.next=at,xt.lastBaseUpdate=G))}if(m!==null){var bt=f.baseState;S=0,xt=at=G=null,R=m;do{var ct=R.lane&-536870913,ht=ct!==R.lane;if(ht?(Le&ct)===ct:(c&ct)===ct){ct!==0&&ct===Fr&&(lh=!0),xt!==null&&(xt=xt.next={lane:0,tag:R.tag,payload:R.payload,callback:null,next:null});t:{var te=n,de=R;ct=i;var je=r;switch(de.tag){case 1:if(te=de.payload,typeof te=="function"){bt=te.call(je,bt,ct);break t}bt=te;break t;case 3:te.flags=te.flags&-65537|128;case 0:if(te=de.payload,ct=typeof te=="function"?te.call(je,bt,ct):te,ct==null)break t;bt=_({},bt,ct);break t;case 2:us=!0}}ct=R.callback,ct!==null&&(n.flags|=64,ht&&(n.flags|=8192),ht=f.callbacks,ht===null?f.callbacks=[ct]:ht.push(ct))}else ht={lane:ct,tag:R.tag,payload:R.payload,callback:R.callback,next:null},xt===null?(at=xt=ht,G=bt):xt=xt.next=ht,S|=ct;if(R=R.next,R===null){if(R=f.shared.pending,R===null)break;ht=R,R=ht.next,ht.next=null,f.lastBaseUpdate=ht,f.shared.pending=null}}while(!0);xt===null&&(G=bt),f.baseState=G,f.firstBaseUpdate=at,f.lastBaseUpdate=xt,m===null&&(f.shared.lanes=0),vs|=S,n.lanes=S,n.memoizedState=bt}}function o0(n,i){if(typeof n!="function")throw Error(a(191,n));n.call(i)}function l0(n,i){var r=n.callbacks;if(r!==null)for(n.callbacks=null,n=0;n<r.length;n++)o0(r[n],i)}var kr=L(null),Ic=L(0);function c0(n,i){n=Oa,_t(Ic,n),_t(kr,i),Oa=n|i.baseLanes}function ch(){_t(Ic,Oa),_t(kr,kr.current)}function uh(){Oa=Ic.current,X(kr),X(Ic)}var Mi=L(null),Ii=null;function ds(n){var i=n.alternate;_t(xn,xn.current&1),_t(Mi,n),Ii===null&&(i===null||kr.current!==null||i.memoizedState!==null)&&(Ii=n)}function fh(n){_t(xn,xn.current),_t(Mi,n),Ii===null&&(Ii=n)}function u0(n){n.tag===22?(_t(xn,xn.current),_t(Mi,n),Ii===null&&(Ii=n)):ps()}function ps(){_t(xn,xn.current),_t(Mi,Mi.current)}function bi(n){X(Mi),Ii===n&&(Ii=null),X(xn)}var xn=L(0);function zc(n){for(var i=n;i!==null;){if(i.tag===13){var r=i.memoizedState;if(r!==null&&(r=r.dehydrated,r===null||vd(r)||_d(r)))return i}else if(i.tag===19&&(i.memoizedProps.revealOrder==="forwards"||i.memoizedProps.revealOrder==="backwards"||i.memoizedProps.revealOrder==="unstable_legacy-backwards"||i.memoizedProps.revealOrder==="together")){if((i.flags&128)!==0)return i}else if(i.child!==null){i.child.return=i,i=i.child;continue}if(i===n)break;for(;i.sibling===null;){if(i.return===null||i.return===n)return null;i=i.return}i.sibling.return=i.return,i=i.sibling}return null}var Aa=0,Ee=null,Qe=null,Tn=null,Fc=!1,Xr=!1,ar=!1,Hc=0,dl=0,Wr=null,TM=0;function vn(){throw Error(a(321))}function hh(n,i){if(i===null)return!1;for(var r=0;r<i.length&&r<n.length;r++)if(!yi(n[r],i[r]))return!1;return!0}function dh(n,i,r,c,f,m){return Aa=m,Ee=i,i.memoizedState=null,i.updateQueue=null,i.lanes=0,F.H=n===null||n.memoizedState===null?Y0:Rh,ar=!1,m=r(c,f),ar=!1,Xr&&(m=h0(i,r,c,f)),f0(n),m}function f0(n){F.H=gl;var i=Qe!==null&&Qe.next!==null;if(Aa=0,Tn=Qe=Ee=null,Fc=!1,dl=0,Wr=null,i)throw Error(a(300));n===null||An||(n=n.dependencies,n!==null&&Dc(n)&&(An=!0))}function h0(n,i,r,c){Ee=n;var f=0;do{if(Xr&&(Wr=null),dl=0,Xr=!1,25<=f)throw Error(a(301));if(f+=1,Tn=Qe=null,n.updateQueue!=null){var m=n.updateQueue;m.lastEffect=null,m.events=null,m.stores=null,m.memoCache!=null&&(m.memoCache.index=0)}F.H=Z0,m=i(r,c)}while(Xr);return m}function AM(){var n=F.H,i=n.useState()[0];return i=typeof i.then=="function"?pl(i):i,n=n.useState()[0],(Qe!==null?Qe.memoizedState:null)!==n&&(Ee.flags|=1024),i}function ph(){var n=Hc!==0;return Hc=0,n}function mh(n,i,r){i.updateQueue=n.updateQueue,i.flags&=-2053,n.lanes&=~r}function gh(n){if(Fc){for(n=n.memoizedState;n!==null;){var i=n.queue;i!==null&&(i.pending=null),n=n.next}Fc=!1}Aa=0,Tn=Qe=Ee=null,Xr=!1,dl=Hc=0,Wr=null}function ii(){var n={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null};return Tn===null?Ee.memoizedState=Tn=n:Tn=Tn.next=n,Tn}function yn(){if(Qe===null){var n=Ee.alternate;n=n!==null?n.memoizedState:null}else n=Qe.next;var i=Tn===null?Ee.memoizedState:Tn.next;if(i!==null)Tn=i,Qe=n;else{if(n===null)throw Ee.alternate===null?Error(a(467)):Error(a(310));Qe=n,n={memoizedState:Qe.memoizedState,baseState:Qe.baseState,baseQueue:Qe.baseQueue,queue:Qe.queue,next:null},Tn===null?Ee.memoizedState=Tn=n:Tn=Tn.next=n}return Tn}function Gc(){return{lastEffect:null,events:null,stores:null,memoCache:null}}function pl(n){var i=dl;return dl+=1,Wr===null&&(Wr=[]),n=n0(Wr,n,i),i=Ee,(Tn===null?i.memoizedState:Tn.next)===null&&(i=i.alternate,F.H=i===null||i.memoizedState===null?Y0:Rh),n}function Vc(n){if(n!==null&&typeof n=="object"){if(typeof n.then=="function")return pl(n);if(n.$$typeof===D)return Hn(n)}throw Error(a(438,String(n)))}function vh(n){var i=null,r=Ee.updateQueue;if(r!==null&&(i=r.memoCache),i==null){var c=Ee.alternate;c!==null&&(c=c.updateQueue,c!==null&&(c=c.memoCache,c!=null&&(i={data:c.data.map(function(f){return f.slice()}),index:0})))}if(i==null&&(i={data:[],index:0}),r===null&&(r=Gc(),Ee.updateQueue=r),r.memoCache=i,r=i.data[i.index],r===void 0)for(r=i.data[i.index]=Array(n),c=0;c<n;c++)r[c]=k;return i.index++,r}function wa(n,i){return typeof i=="function"?i(n):i}function kc(n){var i=yn();return _h(i,Qe,n)}function _h(n,i,r){var c=n.queue;if(c===null)throw Error(a(311));c.lastRenderedReducer=r;var f=n.baseQueue,m=c.pending;if(m!==null){if(f!==null){var S=f.next;f.next=m.next,m.next=S}i.baseQueue=f=m,c.pending=null}if(m=n.baseState,f===null)n.memoizedState=m;else{i=f.next;var R=S=null,G=null,at=i,xt=!1;do{var bt=at.lane&-536870913;if(bt!==at.lane?(Le&bt)===bt:(Aa&bt)===bt){var ct=at.revertLane;if(ct===0)G!==null&&(G=G.next={lane:0,revertLane:0,gesture:null,action:at.action,hasEagerState:at.hasEagerState,eagerState:at.eagerState,next:null}),bt===Fr&&(xt=!0);else if((Aa&ct)===ct){at=at.next,ct===Fr&&(xt=!0);continue}else bt={lane:0,revertLane:at.revertLane,gesture:null,action:at.action,hasEagerState:at.hasEagerState,eagerState:at.eagerState,next:null},G===null?(R=G=bt,S=m):G=G.next=bt,Ee.lanes|=ct,vs|=ct;bt=at.action,ar&&r(m,bt),m=at.hasEagerState?at.eagerState:r(m,bt)}else ct={lane:bt,revertLane:at.revertLane,gesture:at.gesture,action:at.action,hasEagerState:at.hasEagerState,eagerState:at.eagerState,next:null},G===null?(R=G=ct,S=m):G=G.next=ct,Ee.lanes|=bt,vs|=bt;at=at.next}while(at!==null&&at!==i);if(G===null?S=m:G.next=R,!yi(m,n.memoizedState)&&(An=!0,xt&&(r=Hr,r!==null)))throw r;n.memoizedState=m,n.baseState=S,n.baseQueue=G,c.lastRenderedState=m}return f===null&&(c.lanes=0),[n.memoizedState,c.dispatch]}function xh(n){var i=yn(),r=i.queue;if(r===null)throw Error(a(311));r.lastRenderedReducer=n;var c=r.dispatch,f=r.pending,m=i.memoizedState;if(f!==null){r.pending=null;var S=f=f.next;do m=n(m,S.action),S=S.next;while(S!==f);yi(m,i.memoizedState)||(An=!0),i.memoizedState=m,i.baseQueue===null&&(i.baseState=m),r.lastRenderedState=m}return[m,c]}function d0(n,i,r){var c=Ee,f=yn(),m=Be;if(m){if(r===void 0)throw Error(a(407));r=r()}else r=i();var S=!yi((Qe||f).memoizedState,r);if(S&&(f.memoizedState=r,An=!0),f=f.queue,Mh(g0.bind(null,c,f,n),[n]),f.getSnapshot!==i||S||Tn!==null&&Tn.memoizedState.tag&1){if(c.flags|=2048,qr(9,{destroy:void 0},m0.bind(null,c,f,r,i),null),an===null)throw Error(a(349));m||(Aa&127)!==0||p0(c,i,r)}return r}function p0(n,i,r){n.flags|=16384,n={getSnapshot:i,value:r},i=Ee.updateQueue,i===null?(i=Gc(),Ee.updateQueue=i,i.stores=[n]):(r=i.stores,r===null?i.stores=[n]:r.push(n))}function m0(n,i,r,c){i.value=r,i.getSnapshot=c,v0(i)&&_0(n)}function g0(n,i,r){return r(function(){v0(i)&&_0(n)})}function v0(n){var i=n.getSnapshot;n=n.value;try{var r=i();return!yi(n,r)}catch{return!0}}function _0(n){var i=Ks(n,2);i!==null&&mi(i,n,2)}function yh(n){var i=ii();if(typeof n=="function"){var r=n;if(n=r(),ar){Ot(!0);try{r()}finally{Ot(!1)}}}return i.memoizedState=i.baseState=n,i.queue={pending:null,lanes:0,dispatch:null,lastRenderedReducer:wa,lastRenderedState:n},i}function x0(n,i,r,c){return n.baseState=r,_h(n,Qe,typeof c=="function"?c:wa)}function wM(n,i,r,c,f){if(qc(n))throw Error(a(485));if(n=i.action,n!==null){var m={payload:f,action:n,next:null,isTransition:!0,status:"pending",value:null,reason:null,listeners:[],then:function(S){m.listeners.push(S)}};F.T!==null?r(!0):m.isTransition=!1,c(m),r=i.pending,r===null?(m.next=i.pending=m,y0(i,m)):(m.next=r.next,i.pending=r.next=m)}}function y0(n,i){var r=i.action,c=i.payload,f=n.state;if(i.isTransition){var m=F.T,S={};F.T=S;try{var R=r(f,c),G=F.S;G!==null&&G(S,R),S0(n,i,R)}catch(at){Sh(n,i,at)}finally{m!==null&&S.types!==null&&(m.types=S.types),F.T=m}}else try{m=r(f,c),S0(n,i,m)}catch(at){Sh(n,i,at)}}function S0(n,i,r){r!==null&&typeof r=="object"&&typeof r.then=="function"?r.then(function(c){M0(n,i,c)},function(c){return Sh(n,i,c)}):M0(n,i,r)}function M0(n,i,r){i.status="fulfilled",i.value=r,b0(i),n.state=r,i=n.pending,i!==null&&(r=i.next,r===i?n.pending=null:(r=r.next,i.next=r,y0(n,r)))}function Sh(n,i,r){var c=n.pending;if(n.pending=null,c!==null){c=c.next;do i.status="rejected",i.reason=r,b0(i),i=i.next;while(i!==c)}n.action=null}function b0(n){n=n.listeners;for(var i=0;i<n.length;i++)(0,n[i])()}function E0(n,i){return i}function T0(n,i){if(Be){var r=an.formState;if(r!==null){t:{var c=Ee;if(Be){if(on){e:{for(var f=on,m=Bi;f.nodeType!==8;){if(!m){f=null;break e}if(f=zi(f.nextSibling),f===null){f=null;break e}}m=f.data,f=m==="F!"||m==="F"?f:null}if(f){on=zi(f.nextSibling),c=f.data==="F!";break t}}ls(c)}c=!1}c&&(i=r[0])}}return r=ii(),r.memoizedState=r.baseState=i,c={pending:null,lanes:0,dispatch:null,lastRenderedReducer:E0,lastRenderedState:i},r.queue=c,r=X0.bind(null,Ee,c),c.dispatch=r,c=yh(!1),m=wh.bind(null,Ee,!1,c.queue),c=ii(),f={state:i,dispatch:null,action:n,pending:null},c.queue=f,r=wM.bind(null,Ee,f,m,r),f.dispatch=r,c.memoizedState=n,[i,r,!1]}function A0(n){var i=yn();return w0(i,Qe,n)}function w0(n,i,r){if(i=_h(n,i,E0)[0],n=kc(wa)[0],typeof i=="object"&&i!==null&&typeof i.then=="function")try{var c=pl(i)}catch(S){throw S===Gr?Nc:S}else c=i;i=yn();var f=i.queue,m=f.dispatch;return r!==i.memoizedState&&(Ee.flags|=2048,qr(9,{destroy:void 0},RM.bind(null,f,r),null)),[c,m,n]}function RM(n,i){n.action=i}function R0(n){var i=yn(),r=Qe;if(r!==null)return w0(i,r,n);yn(),i=i.memoizedState,r=yn();var c=r.queue.dispatch;return r.memoizedState=n,[i,c,!1]}function qr(n,i,r,c){return n={tag:n,create:r,deps:c,inst:i,next:null},i=Ee.updateQueue,i===null&&(i=Gc(),Ee.updateQueue=i),r=i.lastEffect,r===null?i.lastEffect=n.next=n:(c=r.next,r.next=n,n.next=c,i.lastEffect=n),n}function C0(){return yn().memoizedState}function Xc(n,i,r,c){var f=ii();Ee.flags|=n,f.memoizedState=qr(1|i,{destroy:void 0},r,c===void 0?null:c)}function Wc(n,i,r,c){var f=yn();c=c===void 0?null:c;var m=f.memoizedState.inst;Qe!==null&&c!==null&&hh(c,Qe.memoizedState.deps)?f.memoizedState=qr(i,m,r,c):(Ee.flags|=n,f.memoizedState=qr(1|i,m,r,c))}function D0(n,i){Xc(8390656,8,n,i)}function Mh(n,i){Wc(2048,8,n,i)}function CM(n){Ee.flags|=4;var i=Ee.updateQueue;if(i===null)i=Gc(),Ee.updateQueue=i,i.events=[n];else{var r=i.events;r===null?i.events=[n]:r.push(n)}}function U0(n){var i=yn().memoizedState;return CM({ref:i,nextImpl:n}),function(){if((Ve&2)!==0)throw Error(a(440));return i.impl.apply(void 0,arguments)}}function L0(n,i){return Wc(4,2,n,i)}function N0(n,i){return Wc(4,4,n,i)}function O0(n,i){if(typeof i=="function"){n=n();var r=i(n);return function(){typeof r=="function"?r():i(null)}}if(i!=null)return n=n(),i.current=n,function(){i.current=null}}function P0(n,i,r){r=r!=null?r.concat([n]):null,Wc(4,4,O0.bind(null,i,n),r)}function bh(){}function B0(n,i){var r=yn();i=i===void 0?null:i;var c=r.memoizedState;return i!==null&&hh(i,c[1])?c[0]:(r.memoizedState=[n,i],n)}function I0(n,i){var r=yn();i=i===void 0?null:i;var c=r.memoizedState;if(i!==null&&hh(i,c[1]))return c[0];if(c=n(),ar){Ot(!0);try{n()}finally{Ot(!1)}}return r.memoizedState=[c,i],c}function Eh(n,i,r){return r===void 0||(Aa&1073741824)!==0&&(Le&261930)===0?n.memoizedState=i:(n.memoizedState=r,n=zv(),Ee.lanes|=n,vs|=n,r)}function z0(n,i,r,c){return yi(r,i)?r:kr.current!==null?(n=Eh(n,r,c),yi(n,i)||(An=!0),n):(Aa&42)===0||(Aa&1073741824)!==0&&(Le&261930)===0?(An=!0,n.memoizedState=r):(n=zv(),Ee.lanes|=n,vs|=n,i)}function F0(n,i,r,c,f){var m=N.p;N.p=m!==0&&8>m?m:8;var S=F.T,R={};F.T=R,wh(n,!1,i,r);try{var G=f(),at=F.S;if(at!==null&&at(R,G),G!==null&&typeof G=="object"&&typeof G.then=="function"){var xt=EM(G,c);ml(n,i,xt,Ai(n))}else ml(n,i,c,Ai(n))}catch(bt){ml(n,i,{then:function(){},status:"rejected",reason:bt},Ai())}finally{N.p=m,S!==null&&R.types!==null&&(S.types=R.types),F.T=S}}function DM(){}function Th(n,i,r,c){if(n.tag!==5)throw Error(a(476));var f=H0(n).queue;F0(n,f,i,V,r===null?DM:function(){return G0(n),r(c)})}function H0(n){var i=n.memoizedState;if(i!==null)return i;i={memoizedState:V,baseState:V,baseQueue:null,queue:{pending:null,lanes:0,dispatch:null,lastRenderedReducer:wa,lastRenderedState:V},next:null};var r={};return i.next={memoizedState:r,baseState:r,baseQueue:null,queue:{pending:null,lanes:0,dispatch:null,lastRenderedReducer:wa,lastRenderedState:r},next:null},n.memoizedState=i,n=n.alternate,n!==null&&(n.memoizedState=i),i}function G0(n){var i=H0(n);i.next===null&&(i=n.alternate.memoizedState),ml(n,i.next.queue,{},Ai())}function Ah(){return Hn(Ll)}function V0(){return yn().memoizedState}function k0(){return yn().memoizedState}function UM(n){for(var i=n.return;i!==null;){switch(i.tag){case 24:case 3:var r=Ai();n=fs(r);var c=hs(i,n,r);c!==null&&(mi(c,i,r),ul(c,i,r)),i={cache:eh()},n.payload=i;return}i=i.return}}function LM(n,i,r){var c=Ai();r={lane:c,revertLane:0,gesture:null,action:r,hasEagerState:!1,eagerState:null,next:null},qc(n)?W0(i,r):(r=Xf(n,i,r,c),r!==null&&(mi(r,n,c),q0(r,i,c)))}function X0(n,i,r){var c=Ai();ml(n,i,r,c)}function ml(n,i,r,c){var f={lane:c,revertLane:0,gesture:null,action:r,hasEagerState:!1,eagerState:null,next:null};if(qc(n))W0(i,f);else{var m=n.alternate;if(n.lanes===0&&(m===null||m.lanes===0)&&(m=i.lastRenderedReducer,m!==null))try{var S=i.lastRenderedState,R=m(S,r);if(f.hasEagerState=!0,f.eagerState=R,yi(R,S))return Ac(n,i,f,0),an===null&&Tc(),!1}catch{}if(r=Xf(n,i,f,c),r!==null)return mi(r,n,c),q0(r,i,c),!0}return!1}function wh(n,i,r,c){if(c={lane:2,revertLane:sd(),gesture:null,action:c,hasEagerState:!1,eagerState:null,next:null},qc(n)){if(i)throw Error(a(479))}else i=Xf(n,r,c,2),i!==null&&mi(i,n,2)}function qc(n){var i=n.alternate;return n===Ee||i!==null&&i===Ee}function W0(n,i){Xr=Fc=!0;var r=n.pending;r===null?i.next=i:(i.next=r.next,r.next=i),n.pending=i}function q0(n,i,r){if((r&4194048)!==0){var c=i.lanes;c&=n.pendingLanes,r|=c,i.lanes=r,gi(n,r)}}var gl={readContext:Hn,use:Vc,useCallback:vn,useContext:vn,useEffect:vn,useImperativeHandle:vn,useLayoutEffect:vn,useInsertionEffect:vn,useMemo:vn,useReducer:vn,useRef:vn,useState:vn,useDebugValue:vn,useDeferredValue:vn,useTransition:vn,useSyncExternalStore:vn,useId:vn,useHostTransitionStatus:vn,useFormState:vn,useActionState:vn,useOptimistic:vn,useMemoCache:vn,useCacheRefresh:vn};gl.useEffectEvent=vn;var Y0={readContext:Hn,use:Vc,useCallback:function(n,i){return ii().memoizedState=[n,i===void 0?null:i],n},useContext:Hn,useEffect:D0,useImperativeHandle:function(n,i,r){r=r!=null?r.concat([n]):null,Xc(4194308,4,O0.bind(null,i,n),r)},useLayoutEffect:function(n,i){return Xc(4194308,4,n,i)},useInsertionEffect:function(n,i){Xc(4,2,n,i)},useMemo:function(n,i){var r=ii();i=i===void 0?null:i;var c=n();if(ar){Ot(!0);try{n()}finally{Ot(!1)}}return r.memoizedState=[c,i],c},useReducer:function(n,i,r){var c=ii();if(r!==void 0){var f=r(i);if(ar){Ot(!0);try{r(i)}finally{Ot(!1)}}}else f=i;return c.memoizedState=c.baseState=f,n={pending:null,lanes:0,dispatch:null,lastRenderedReducer:n,lastRenderedState:f},c.queue=n,n=n.dispatch=LM.bind(null,Ee,n),[c.memoizedState,n]},useRef:function(n){var i=ii();return n={current:n},i.memoizedState=n},useState:function(n){n=yh(n);var i=n.queue,r=X0.bind(null,Ee,i);return i.dispatch=r,[n.memoizedState,r]},useDebugValue:bh,useDeferredValue:function(n,i){var r=ii();return Eh(r,n,i)},useTransition:function(){var n=yh(!1);return n=F0.bind(null,Ee,n.queue,!0,!1),ii().memoizedState=n,[!1,n]},useSyncExternalStore:function(n,i,r){var c=Ee,f=ii();if(Be){if(r===void 0)throw Error(a(407));r=r()}else{if(r=i(),an===null)throw Error(a(349));(Le&127)!==0||p0(c,i,r)}f.memoizedState=r;var m={value:r,getSnapshot:i};return f.queue=m,D0(g0.bind(null,c,m,n),[n]),c.flags|=2048,qr(9,{destroy:void 0},m0.bind(null,c,m,r,i),null),r},useId:function(){var n=ii(),i=an.identifierPrefix;if(Be){var r=sa,c=aa;r=(c&~(1<<32-Yt(c)-1)).toString(32)+r,i="_"+i+"R_"+r,r=Hc++,0<r&&(i+="H"+r.toString(32)),i+="_"}else r=TM++,i="_"+i+"r_"+r.toString(32)+"_";return n.memoizedState=i},useHostTransitionStatus:Ah,useFormState:T0,useActionState:T0,useOptimistic:function(n){var i=ii();i.memoizedState=i.baseState=n;var r={pending:null,lanes:0,dispatch:null,lastRenderedReducer:null,lastRenderedState:null};return i.queue=r,i=wh.bind(null,Ee,!0,r),r.dispatch=i,[n,i]},useMemoCache:vh,useCacheRefresh:function(){return ii().memoizedState=UM.bind(null,Ee)},useEffectEvent:function(n){var i=ii(),r={impl:n};return i.memoizedState=r,function(){if((Ve&2)!==0)throw Error(a(440));return r.impl.apply(void 0,arguments)}}},Rh={readContext:Hn,use:Vc,useCallback:B0,useContext:Hn,useEffect:Mh,useImperativeHandle:P0,useInsertionEffect:L0,useLayoutEffect:N0,useMemo:I0,useReducer:kc,useRef:C0,useState:function(){return kc(wa)},useDebugValue:bh,useDeferredValue:function(n,i){var r=yn();return z0(r,Qe.memoizedState,n,i)},useTransition:function(){var n=kc(wa)[0],i=yn().memoizedState;return[typeof n=="boolean"?n:pl(n),i]},useSyncExternalStore:d0,useId:V0,useHostTransitionStatus:Ah,useFormState:A0,useActionState:A0,useOptimistic:function(n,i){var r=yn();return x0(r,Qe,n,i)},useMemoCache:vh,useCacheRefresh:k0};Rh.useEffectEvent=U0;var Z0={readContext:Hn,use:Vc,useCallback:B0,useContext:Hn,useEffect:Mh,useImperativeHandle:P0,useInsertionEffect:L0,useLayoutEffect:N0,useMemo:I0,useReducer:xh,useRef:C0,useState:function(){return xh(wa)},useDebugValue:bh,useDeferredValue:function(n,i){var r=yn();return Qe===null?Eh(r,n,i):z0(r,Qe.memoizedState,n,i)},useTransition:function(){var n=xh(wa)[0],i=yn().memoizedState;return[typeof n=="boolean"?n:pl(n),i]},useSyncExternalStore:d0,useId:V0,useHostTransitionStatus:Ah,useFormState:R0,useActionState:R0,useOptimistic:function(n,i){var r=yn();return Qe!==null?x0(r,Qe,n,i):(r.baseState=n,[n,r.queue.dispatch])},useMemoCache:vh,useCacheRefresh:k0};Z0.useEffectEvent=U0;function Ch(n,i,r,c){i=n.memoizedState,r=r(c,i),r=r==null?i:_({},i,r),n.memoizedState=r,n.lanes===0&&(n.updateQueue.baseState=r)}var Dh={enqueueSetState:function(n,i,r){n=n._reactInternals;var c=Ai(),f=fs(c);f.payload=i,r!=null&&(f.callback=r),i=hs(n,f,c),i!==null&&(mi(i,n,c),ul(i,n,c))},enqueueReplaceState:function(n,i,r){n=n._reactInternals;var c=Ai(),f=fs(c);f.tag=1,f.payload=i,r!=null&&(f.callback=r),i=hs(n,f,c),i!==null&&(mi(i,n,c),ul(i,n,c))},enqueueForceUpdate:function(n,i){n=n._reactInternals;var r=Ai(),c=fs(r);c.tag=2,i!=null&&(c.callback=i),i=hs(n,c,r),i!==null&&(mi(i,n,r),ul(i,n,r))}};function K0(n,i,r,c,f,m,S){return n=n.stateNode,typeof n.shouldComponentUpdate=="function"?n.shouldComponentUpdate(c,m,S):i.prototype&&i.prototype.isPureReactComponent?!nl(r,c)||!nl(f,m):!0}function J0(n,i,r,c){n=i.state,typeof i.componentWillReceiveProps=="function"&&i.componentWillReceiveProps(r,c),typeof i.UNSAFE_componentWillReceiveProps=="function"&&i.UNSAFE_componentWillReceiveProps(r,c),i.state!==n&&Dh.enqueueReplaceState(i,i.state,null)}function sr(n,i){var r=i;if("ref"in i){r={};for(var c in i)c!=="ref"&&(r[c]=i[c])}if(n=n.defaultProps){r===i&&(r=_({},r));for(var f in n)r[f]===void 0&&(r[f]=n[f])}return r}function Q0(n){Ec(n)}function $0(n){console.error(n)}function j0(n){Ec(n)}function Yc(n,i){try{var r=n.onUncaughtError;r(i.value,{componentStack:i.stack})}catch(c){setTimeout(function(){throw c})}}function tv(n,i,r){try{var c=n.onCaughtError;c(r.value,{componentStack:r.stack,errorBoundary:i.tag===1?i.stateNode:null})}catch(f){setTimeout(function(){throw f})}}function Uh(n,i,r){return r=fs(r),r.tag=3,r.payload={element:null},r.callback=function(){Yc(n,i)},r}function ev(n){return n=fs(n),n.tag=3,n}function nv(n,i,r,c){var f=r.type.getDerivedStateFromError;if(typeof f=="function"){var m=c.value;n.payload=function(){return f(m)},n.callback=function(){tv(i,r,c)}}var S=r.stateNode;S!==null&&typeof S.componentDidCatch=="function"&&(n.callback=function(){tv(i,r,c),typeof f!="function"&&(_s===null?_s=new Set([this]):_s.add(this));var R=c.stack;this.componentDidCatch(c.value,{componentStack:R!==null?R:""})})}function NM(n,i,r,c,f){if(r.flags|=32768,c!==null&&typeof c=="object"&&typeof c.then=="function"){if(i=r.alternate,i!==null&&zr(i,r,f,!0),r=Mi.current,r!==null){switch(r.tag){case 31:case 13:return Ii===null?su():r.alternate===null&&_n===0&&(_n=3),r.flags&=-257,r.flags|=65536,r.lanes=f,c===Oc?r.flags|=16384:(i=r.updateQueue,i===null?r.updateQueue=new Set([c]):i.add(c),nd(n,c,f)),!1;case 22:return r.flags|=65536,c===Oc?r.flags|=16384:(i=r.updateQueue,i===null?(i={transitions:null,markerInstances:null,retryQueue:new Set([c])},r.updateQueue=i):(r=i.retryQueue,r===null?i.retryQueue=new Set([c]):r.add(c)),nd(n,c,f)),!1}throw Error(a(435,r.tag))}return nd(n,c,f),su(),!1}if(Be)return i=Mi.current,i!==null?((i.flags&65536)===0&&(i.flags|=256),i.flags|=65536,i.lanes=f,c!==Jf&&(n=Error(a(422),{cause:c}),sl(Ni(n,r)))):(c!==Jf&&(i=Error(a(423),{cause:c}),sl(Ni(i,r))),n=n.current.alternate,n.flags|=65536,f&=-f,n.lanes|=f,c=Ni(c,r),f=Uh(n.stateNode,c,f),oh(n,f),_n!==4&&(_n=2)),!1;var m=Error(a(520),{cause:c});if(m=Ni(m,r),El===null?El=[m]:El.push(m),_n!==4&&(_n=2),i===null)return!0;c=Ni(c,r),r=i;do{switch(r.tag){case 3:return r.flags|=65536,n=f&-f,r.lanes|=n,n=Uh(r.stateNode,c,n),oh(r,n),!1;case 1:if(i=r.type,m=r.stateNode,(r.flags&128)===0&&(typeof i.getDerivedStateFromError=="function"||m!==null&&typeof m.componentDidCatch=="function"&&(_s===null||!_s.has(m))))return r.flags|=65536,f&=-f,r.lanes|=f,f=ev(f),nv(f,n,r,c),oh(r,f),!1}r=r.return}while(r!==null);return!1}var Lh=Error(a(461)),An=!1;function Gn(n,i,r,c){i.child=n===null?r0(i,null,r,c):ir(i,n.child,r,c)}function iv(n,i,r,c,f){r=r.render;var m=i.ref;if("ref"in c){var S={};for(var R in c)R!=="ref"&&(S[R]=c[R])}else S=c;return js(i),c=dh(n,i,r,S,m,f),R=ph(),n!==null&&!An?(mh(n,i,f),Ra(n,i,f)):(Be&&R&&Zf(i),i.flags|=1,Gn(n,i,c,f),i.child)}function av(n,i,r,c,f){if(n===null){var m=r.type;return typeof m=="function"&&!Wf(m)&&m.defaultProps===void 0&&r.compare===null?(i.tag=15,i.type=m,sv(n,i,m,c,f)):(n=Rc(r.type,null,c,i,i.mode,f),n.ref=i.ref,n.return=i,i.child=n)}if(m=n.child,!Hh(n,f)){var S=m.memoizedProps;if(r=r.compare,r=r!==null?r:nl,r(S,c)&&n.ref===i.ref)return Ra(n,i,f)}return i.flags|=1,n=Ma(m,c),n.ref=i.ref,n.return=i,i.child=n}function sv(n,i,r,c,f){if(n!==null){var m=n.memoizedProps;if(nl(m,c)&&n.ref===i.ref)if(An=!1,i.pendingProps=c=m,Hh(n,f))(n.flags&131072)!==0&&(An=!0);else return i.lanes=n.lanes,Ra(n,i,f)}return Nh(n,i,r,c,f)}function rv(n,i,r,c){var f=c.children,m=n!==null?n.memoizedState:null;if(n===null&&i.stateNode===null&&(i.stateNode={_visibility:1,_pendingMarkers:null,_retryCache:null,_transitions:null}),c.mode==="hidden"){if((i.flags&128)!==0){if(m=m!==null?m.baseLanes|r:r,n!==null){for(c=i.child=n.child,f=0;c!==null;)f=f|c.lanes|c.childLanes,c=c.sibling;c=f&~m}else c=0,i.child=null;return ov(n,i,m,r,c)}if((r&536870912)!==0)i.memoizedState={baseLanes:0,cachePool:null},n!==null&&Lc(i,m!==null?m.cachePool:null),m!==null?c0(i,m):ch(),u0(i);else return c=i.lanes=536870912,ov(n,i,m!==null?m.baseLanes|r:r,r,c)}else m!==null?(Lc(i,m.cachePool),c0(i,m),ps(),i.memoizedState=null):(n!==null&&Lc(i,null),ch(),ps());return Gn(n,i,f,r),i.child}function vl(n,i){return n!==null&&n.tag===22||i.stateNode!==null||(i.stateNode={_visibility:1,_pendingMarkers:null,_retryCache:null,_transitions:null}),i.sibling}function ov(n,i,r,c,f){var m=ih();return m=m===null?null:{parent:En._currentValue,pool:m},i.memoizedState={baseLanes:r,cachePool:m},n!==null&&Lc(i,null),ch(),u0(i),n!==null&&zr(n,i,c,!0),i.childLanes=f,null}function Zc(n,i){return i=Jc({mode:i.mode,children:i.children},n.mode),i.ref=n.ref,n.child=i,i.return=n,i}function lv(n,i,r){return ir(i,n.child,null,r),n=Zc(i,i.pendingProps),n.flags|=2,bi(i),i.memoizedState=null,n}function OM(n,i,r){var c=i.pendingProps,f=(i.flags&128)!==0;if(i.flags&=-129,n===null){if(Be){if(c.mode==="hidden")return n=Zc(i,c),i.lanes=536870912,vl(null,n);if(fh(i),(n=on)?(n=y_(n,Bi),n=n!==null&&n.data==="&"?n:null,n!==null&&(i.memoizedState={dehydrated:n,treeContext:rs!==null?{id:aa,overflow:sa}:null,retryLane:536870912,hydrationErrors:null},r=Wg(n),r.return=i,i.child=r,Fn=i,on=null)):n=null,n===null)throw ls(i);return i.lanes=536870912,null}return Zc(i,c)}var m=n.memoizedState;if(m!==null){var S=m.dehydrated;if(fh(i),f)if(i.flags&256)i.flags&=-257,i=lv(n,i,r);else if(i.memoizedState!==null)i.child=n.child,i.flags|=128,i=null;else throw Error(a(558));else if(An||zr(n,i,r,!1),f=(r&n.childLanes)!==0,An||f){if(c=an,c!==null&&(S=vi(c,r),S!==0&&S!==m.retryLane))throw m.retryLane=S,Ks(n,S),mi(c,n,S),Lh;su(),i=lv(n,i,r)}else n=m.treeContext,on=zi(S.nextSibling),Fn=i,Be=!0,os=null,Bi=!1,n!==null&&Zg(i,n),i=Zc(i,c),i.flags|=4096;return i}return n=Ma(n.child,{mode:c.mode,children:c.children}),n.ref=i.ref,i.child=n,n.return=i,n}function Kc(n,i){var r=i.ref;if(r===null)n!==null&&n.ref!==null&&(i.flags|=4194816);else{if(typeof r!="function"&&typeof r!="object")throw Error(a(284));(n===null||n.ref!==r)&&(i.flags|=4194816)}}function Nh(n,i,r,c,f){return js(i),r=dh(n,i,r,c,void 0,f),c=ph(),n!==null&&!An?(mh(n,i,f),Ra(n,i,f)):(Be&&c&&Zf(i),i.flags|=1,Gn(n,i,r,f),i.child)}function cv(n,i,r,c,f,m){return js(i),i.updateQueue=null,r=h0(i,c,r,f),f0(n),c=ph(),n!==null&&!An?(mh(n,i,m),Ra(n,i,m)):(Be&&c&&Zf(i),i.flags|=1,Gn(n,i,r,m),i.child)}function uv(n,i,r,c,f){if(js(i),i.stateNode===null){var m=Or,S=r.contextType;typeof S=="object"&&S!==null&&(m=Hn(S)),m=new r(c,m),i.memoizedState=m.state!==null&&m.state!==void 0?m.state:null,m.updater=Dh,i.stateNode=m,m._reactInternals=i,m=i.stateNode,m.props=c,m.state=i.memoizedState,m.refs={},sh(i),S=r.contextType,m.context=typeof S=="object"&&S!==null?Hn(S):Or,m.state=i.memoizedState,S=r.getDerivedStateFromProps,typeof S=="function"&&(Ch(i,r,S,c),m.state=i.memoizedState),typeof r.getDerivedStateFromProps=="function"||typeof m.getSnapshotBeforeUpdate=="function"||typeof m.UNSAFE_componentWillMount!="function"&&typeof m.componentWillMount!="function"||(S=m.state,typeof m.componentWillMount=="function"&&m.componentWillMount(),typeof m.UNSAFE_componentWillMount=="function"&&m.UNSAFE_componentWillMount(),S!==m.state&&Dh.enqueueReplaceState(m,m.state,null),hl(i,c,m,f),fl(),m.state=i.memoizedState),typeof m.componentDidMount=="function"&&(i.flags|=4194308),c=!0}else if(n===null){m=i.stateNode;var R=i.memoizedProps,G=sr(r,R);m.props=G;var at=m.context,xt=r.contextType;S=Or,typeof xt=="object"&&xt!==null&&(S=Hn(xt));var bt=r.getDerivedStateFromProps;xt=typeof bt=="function"||typeof m.getSnapshotBeforeUpdate=="function",R=i.pendingProps!==R,xt||typeof m.UNSAFE_componentWillReceiveProps!="function"&&typeof m.componentWillReceiveProps!="function"||(R||at!==S)&&J0(i,m,c,S),us=!1;var ct=i.memoizedState;m.state=ct,hl(i,c,m,f),fl(),at=i.memoizedState,R||ct!==at||us?(typeof bt=="function"&&(Ch(i,r,bt,c),at=i.memoizedState),(G=us||K0(i,r,G,c,ct,at,S))?(xt||typeof m.UNSAFE_componentWillMount!="function"&&typeof m.componentWillMount!="function"||(typeof m.componentWillMount=="function"&&m.componentWillMount(),typeof m.UNSAFE_componentWillMount=="function"&&m.UNSAFE_componentWillMount()),typeof m.componentDidMount=="function"&&(i.flags|=4194308)):(typeof m.componentDidMount=="function"&&(i.flags|=4194308),i.memoizedProps=c,i.memoizedState=at),m.props=c,m.state=at,m.context=S,c=G):(typeof m.componentDidMount=="function"&&(i.flags|=4194308),c=!1)}else{m=i.stateNode,rh(n,i),S=i.memoizedProps,xt=sr(r,S),m.props=xt,bt=i.pendingProps,ct=m.context,at=r.contextType,G=Or,typeof at=="object"&&at!==null&&(G=Hn(at)),R=r.getDerivedStateFromProps,(at=typeof R=="function"||typeof m.getSnapshotBeforeUpdate=="function")||typeof m.UNSAFE_componentWillReceiveProps!="function"&&typeof m.componentWillReceiveProps!="function"||(S!==bt||ct!==G)&&J0(i,m,c,G),us=!1,ct=i.memoizedState,m.state=ct,hl(i,c,m,f),fl();var ht=i.memoizedState;S!==bt||ct!==ht||us||n!==null&&n.dependencies!==null&&Dc(n.dependencies)?(typeof R=="function"&&(Ch(i,r,R,c),ht=i.memoizedState),(xt=us||K0(i,r,xt,c,ct,ht,G)||n!==null&&n.dependencies!==null&&Dc(n.dependencies))?(at||typeof m.UNSAFE_componentWillUpdate!="function"&&typeof m.componentWillUpdate!="function"||(typeof m.componentWillUpdate=="function"&&m.componentWillUpdate(c,ht,G),typeof m.UNSAFE_componentWillUpdate=="function"&&m.UNSAFE_componentWillUpdate(c,ht,G)),typeof m.componentDidUpdate=="function"&&(i.flags|=4),typeof m.getSnapshotBeforeUpdate=="function"&&(i.flags|=1024)):(typeof m.componentDidUpdate!="function"||S===n.memoizedProps&&ct===n.memoizedState||(i.flags|=4),typeof m.getSnapshotBeforeUpdate!="function"||S===n.memoizedProps&&ct===n.memoizedState||(i.flags|=1024),i.memoizedProps=c,i.memoizedState=ht),m.props=c,m.state=ht,m.context=G,c=xt):(typeof m.componentDidUpdate!="function"||S===n.memoizedProps&&ct===n.memoizedState||(i.flags|=4),typeof m.getSnapshotBeforeUpdate!="function"||S===n.memoizedProps&&ct===n.memoizedState||(i.flags|=1024),c=!1)}return m=c,Kc(n,i),c=(i.flags&128)!==0,m||c?(m=i.stateNode,r=c&&typeof r.getDerivedStateFromError!="function"?null:m.render(),i.flags|=1,n!==null&&c?(i.child=ir(i,n.child,null,f),i.child=ir(i,null,r,f)):Gn(n,i,r,f),i.memoizedState=m.state,n=i.child):n=Ra(n,i,f),n}function fv(n,i,r,c){return Qs(),i.flags|=256,Gn(n,i,r,c),i.child}var Oh={dehydrated:null,treeContext:null,retryLane:0,hydrationErrors:null};function Ph(n){return{baseLanes:n,cachePool:t0()}}function Bh(n,i,r){return n=n!==null?n.childLanes&~r:0,i&&(n|=Ti),n}function hv(n,i,r){var c=i.pendingProps,f=!1,m=(i.flags&128)!==0,S;if((S=m)||(S=n!==null&&n.memoizedState===null?!1:(xn.current&2)!==0),S&&(f=!0,i.flags&=-129),S=(i.flags&32)!==0,i.flags&=-33,n===null){if(Be){if(f?ds(i):ps(),(n=on)?(n=y_(n,Bi),n=n!==null&&n.data!=="&"?n:null,n!==null&&(i.memoizedState={dehydrated:n,treeContext:rs!==null?{id:aa,overflow:sa}:null,retryLane:536870912,hydrationErrors:null},r=Wg(n),r.return=i,i.child=r,Fn=i,on=null)):n=null,n===null)throw ls(i);return _d(n)?i.lanes=32:i.lanes=536870912,null}var R=c.children;return c=c.fallback,f?(ps(),f=i.mode,R=Jc({mode:"hidden",children:R},f),c=Js(c,f,r,null),R.return=i,c.return=i,R.sibling=c,i.child=R,c=i.child,c.memoizedState=Ph(r),c.childLanes=Bh(n,S,r),i.memoizedState=Oh,vl(null,c)):(ds(i),Ih(i,R))}var G=n.memoizedState;if(G!==null&&(R=G.dehydrated,R!==null)){if(m)i.flags&256?(ds(i),i.flags&=-257,i=zh(n,i,r)):i.memoizedState!==null?(ps(),i.child=n.child,i.flags|=128,i=null):(ps(),R=c.fallback,f=i.mode,c=Jc({mode:"visible",children:c.children},f),R=Js(R,f,r,null),R.flags|=2,c.return=i,R.return=i,c.sibling=R,i.child=c,ir(i,n.child,null,r),c=i.child,c.memoizedState=Ph(r),c.childLanes=Bh(n,S,r),i.memoizedState=Oh,i=vl(null,c));else if(ds(i),_d(R)){if(S=R.nextSibling&&R.nextSibling.dataset,S)var at=S.dgst;S=at,c=Error(a(419)),c.stack="",c.digest=S,sl({value:c,source:null,stack:null}),i=zh(n,i,r)}else if(An||zr(n,i,r,!1),S=(r&n.childLanes)!==0,An||S){if(S=an,S!==null&&(c=vi(S,r),c!==0&&c!==G.retryLane))throw G.retryLane=c,Ks(n,c),mi(S,n,c),Lh;vd(R)||su(),i=zh(n,i,r)}else vd(R)?(i.flags|=192,i.child=n.child,i=null):(n=G.treeContext,on=zi(R.nextSibling),Fn=i,Be=!0,os=null,Bi=!1,n!==null&&Zg(i,n),i=Ih(i,c.children),i.flags|=4096);return i}return f?(ps(),R=c.fallback,f=i.mode,G=n.child,at=G.sibling,c=Ma(G,{mode:"hidden",children:c.children}),c.subtreeFlags=G.subtreeFlags&65011712,at!==null?R=Ma(at,R):(R=Js(R,f,r,null),R.flags|=2),R.return=i,c.return=i,c.sibling=R,i.child=c,vl(null,c),c=i.child,R=n.child.memoizedState,R===null?R=Ph(r):(f=R.cachePool,f!==null?(G=En._currentValue,f=f.parent!==G?{parent:G,pool:G}:f):f=t0(),R={baseLanes:R.baseLanes|r,cachePool:f}),c.memoizedState=R,c.childLanes=Bh(n,S,r),i.memoizedState=Oh,vl(n.child,c)):(ds(i),r=n.child,n=r.sibling,r=Ma(r,{mode:"visible",children:c.children}),r.return=i,r.sibling=null,n!==null&&(S=i.deletions,S===null?(i.deletions=[n],i.flags|=16):S.push(n)),i.child=r,i.memoizedState=null,r)}function Ih(n,i){return i=Jc({mode:"visible",children:i},n.mode),i.return=n,n.child=i}function Jc(n,i){return n=Si(22,n,null,i),n.lanes=0,n}function zh(n,i,r){return ir(i,n.child,null,r),n=Ih(i,i.pendingProps.children),n.flags|=2,i.memoizedState=null,n}function dv(n,i,r){n.lanes|=i;var c=n.alternate;c!==null&&(c.lanes|=i),jf(n.return,i,r)}function Fh(n,i,r,c,f,m){var S=n.memoizedState;S===null?n.memoizedState={isBackwards:i,rendering:null,renderingStartTime:0,last:c,tail:r,tailMode:f,treeForkCount:m}:(S.isBackwards=i,S.rendering=null,S.renderingStartTime=0,S.last=c,S.tail=r,S.tailMode=f,S.treeForkCount=m)}function pv(n,i,r){var c=i.pendingProps,f=c.revealOrder,m=c.tail;c=c.children;var S=xn.current,R=(S&2)!==0;if(R?(S=S&1|2,i.flags|=128):S&=1,_t(xn,S),Gn(n,i,c,r),c=Be?al:0,!R&&n!==null&&(n.flags&128)!==0)t:for(n=i.child;n!==null;){if(n.tag===13)n.memoizedState!==null&&dv(n,r,i);else if(n.tag===19)dv(n,r,i);else if(n.child!==null){n.child.return=n,n=n.child;continue}if(n===i)break t;for(;n.sibling===null;){if(n.return===null||n.return===i)break t;n=n.return}n.sibling.return=n.return,n=n.sibling}switch(f){case"forwards":for(r=i.child,f=null;r!==null;)n=r.alternate,n!==null&&zc(n)===null&&(f=r),r=r.sibling;r=f,r===null?(f=i.child,i.child=null):(f=r.sibling,r.sibling=null),Fh(i,!1,f,r,m,c);break;case"backwards":case"unstable_legacy-backwards":for(r=null,f=i.child,i.child=null;f!==null;){if(n=f.alternate,n!==null&&zc(n)===null){i.child=f;break}n=f.sibling,f.sibling=r,r=f,f=n}Fh(i,!0,r,null,m,c);break;case"together":Fh(i,!1,null,null,void 0,c);break;default:i.memoizedState=null}return i.child}function Ra(n,i,r){if(n!==null&&(i.dependencies=n.dependencies),vs|=i.lanes,(r&i.childLanes)===0)if(n!==null){if(zr(n,i,r,!1),(r&i.childLanes)===0)return null}else return null;if(n!==null&&i.child!==n.child)throw Error(a(153));if(i.child!==null){for(n=i.child,r=Ma(n,n.pendingProps),i.child=r,r.return=i;n.sibling!==null;)n=n.sibling,r=r.sibling=Ma(n,n.pendingProps),r.return=i;r.sibling=null}return i.child}function Hh(n,i){return(n.lanes&i)!==0?!0:(n=n.dependencies,!!(n!==null&&Dc(n)))}function PM(n,i,r){switch(i.tag){case 3:Et(i,i.stateNode.containerInfo),cs(i,En,n.memoizedState.cache),Qs();break;case 27:case 5:oe(i);break;case 4:Et(i,i.stateNode.containerInfo);break;case 10:cs(i,i.type,i.memoizedProps.value);break;case 31:if(i.memoizedState!==null)return i.flags|=128,fh(i),null;break;case 13:var c=i.memoizedState;if(c!==null)return c.dehydrated!==null?(ds(i),i.flags|=128,null):(r&i.child.childLanes)!==0?hv(n,i,r):(ds(i),n=Ra(n,i,r),n!==null?n.sibling:null);ds(i);break;case 19:var f=(n.flags&128)!==0;if(c=(r&i.childLanes)!==0,c||(zr(n,i,r,!1),c=(r&i.childLanes)!==0),f){if(c)return pv(n,i,r);i.flags|=128}if(f=i.memoizedState,f!==null&&(f.rendering=null,f.tail=null,f.lastEffect=null),_t(xn,xn.current),c)break;return null;case 22:return i.lanes=0,rv(n,i,r,i.pendingProps);case 24:cs(i,En,n.memoizedState.cache)}return Ra(n,i,r)}function mv(n,i,r){if(n!==null)if(n.memoizedProps!==i.pendingProps)An=!0;else{if(!Hh(n,r)&&(i.flags&128)===0)return An=!1,PM(n,i,r);An=(n.flags&131072)!==0}else An=!1,Be&&(i.flags&1048576)!==0&&Yg(i,al,i.index);switch(i.lanes=0,i.tag){case 16:t:{var c=i.pendingProps;if(n=er(i.elementType),i.type=n,typeof n=="function")Wf(n)?(c=sr(n,c),i.tag=1,i=uv(null,i,n,c,r)):(i.tag=0,i=Nh(null,i,n,c,r));else{if(n!=null){var f=n.$$typeof;if(f===A){i.tag=11,i=iv(null,i,n,c,r);break t}else if(f===z){i.tag=14,i=av(null,i,n,c,r);break t}}throw i=dt(n)||n,Error(a(306,i,""))}}return i;case 0:return Nh(n,i,i.type,i.pendingProps,r);case 1:return c=i.type,f=sr(c,i.pendingProps),uv(n,i,c,f,r);case 3:t:{if(Et(i,i.stateNode.containerInfo),n===null)throw Error(a(387));c=i.pendingProps;var m=i.memoizedState;f=m.element,rh(n,i),hl(i,c,null,r);var S=i.memoizedState;if(c=S.cache,cs(i,En,c),c!==m.cache&&th(i,[En],r,!0),fl(),c=S.element,m.isDehydrated)if(m={element:c,isDehydrated:!1,cache:S.cache},i.updateQueue.baseState=m,i.memoizedState=m,i.flags&256){i=fv(n,i,c,r);break t}else if(c!==f){f=Ni(Error(a(424)),i),sl(f),i=fv(n,i,c,r);break t}else for(n=i.stateNode.containerInfo,n.nodeType===9?n=n.body:n=n.nodeName==="HTML"?n.ownerDocument.body:n,on=zi(n.firstChild),Fn=i,Be=!0,os=null,Bi=!0,r=r0(i,null,c,r),i.child=r;r;)r.flags=r.flags&-3|4096,r=r.sibling;else{if(Qs(),c===f){i=Ra(n,i,r);break t}Gn(n,i,c,r)}i=i.child}return i;case 26:return Kc(n,i),n===null?(r=A_(i.type,null,i.pendingProps,null))?i.memoizedState=r:Be||(r=i.type,n=i.pendingProps,c=hu(et.current).createElement(r),c[Mn]=i,c[zn]=n,Vn(c,r,n),bn(c),i.stateNode=c):i.memoizedState=A_(i.type,n.memoizedProps,i.pendingProps,n.memoizedState),null;case 27:return oe(i),n===null&&Be&&(c=i.stateNode=b_(i.type,i.pendingProps,et.current),Fn=i,Bi=!0,f=on,Ms(i.type)?(xd=f,on=zi(c.firstChild)):on=f),Gn(n,i,i.pendingProps.children,r),Kc(n,i),n===null&&(i.flags|=4194304),i.child;case 5:return n===null&&Be&&((f=c=on)&&(c=fb(c,i.type,i.pendingProps,Bi),c!==null?(i.stateNode=c,Fn=i,on=zi(c.firstChild),Bi=!1,f=!0):f=!1),f||ls(i)),oe(i),f=i.type,m=i.pendingProps,S=n!==null?n.memoizedProps:null,c=m.children,pd(f,m)?c=null:S!==null&&pd(f,S)&&(i.flags|=32),i.memoizedState!==null&&(f=dh(n,i,AM,null,null,r),Ll._currentValue=f),Kc(n,i),Gn(n,i,c,r),i.child;case 6:return n===null&&Be&&((n=r=on)&&(r=hb(r,i.pendingProps,Bi),r!==null?(i.stateNode=r,Fn=i,on=null,n=!0):n=!1),n||ls(i)),null;case 13:return hv(n,i,r);case 4:return Et(i,i.stateNode.containerInfo),c=i.pendingProps,n===null?i.child=ir(i,null,c,r):Gn(n,i,c,r),i.child;case 11:return iv(n,i,i.type,i.pendingProps,r);case 7:return Gn(n,i,i.pendingProps,r),i.child;case 8:return Gn(n,i,i.pendingProps.children,r),i.child;case 12:return Gn(n,i,i.pendingProps.children,r),i.child;case 10:return c=i.pendingProps,cs(i,i.type,c.value),Gn(n,i,c.children,r),i.child;case 9:return f=i.type._context,c=i.pendingProps.children,js(i),f=Hn(f),c=c(f),i.flags|=1,Gn(n,i,c,r),i.child;case 14:return av(n,i,i.type,i.pendingProps,r);case 15:return sv(n,i,i.type,i.pendingProps,r);case 19:return pv(n,i,r);case 31:return OM(n,i,r);case 22:return rv(n,i,r,i.pendingProps);case 24:return js(i),c=Hn(En),n===null?(f=ih(),f===null&&(f=an,m=eh(),f.pooledCache=m,m.refCount++,m!==null&&(f.pooledCacheLanes|=r),f=m),i.memoizedState={parent:c,cache:f},sh(i),cs(i,En,f)):((n.lanes&r)!==0&&(rh(n,i),hl(i,null,null,r),fl()),f=n.memoizedState,m=i.memoizedState,f.parent!==c?(f={parent:c,cache:c},i.memoizedState=f,i.lanes===0&&(i.memoizedState=i.updateQueue.baseState=f),cs(i,En,c)):(c=m.cache,cs(i,En,c),c!==f.cache&&th(i,[En],r,!0))),Gn(n,i,i.pendingProps.children,r),i.child;case 29:throw i.pendingProps}throw Error(a(156,i.tag))}function Ca(n){n.flags|=4}function Gh(n,i,r,c,f){if((i=(n.mode&32)!==0)&&(i=!1),i){if(n.flags|=16777216,(f&335544128)===f)if(n.stateNode.complete)n.flags|=8192;else if(Vv())n.flags|=8192;else throw nr=Oc,ah}else n.flags&=-16777217}function gv(n,i){if(i.type!=="stylesheet"||(i.state.loading&4)!==0)n.flags&=-16777217;else if(n.flags|=16777216,!U_(i))if(Vv())n.flags|=8192;else throw nr=Oc,ah}function Qc(n,i){i!==null&&(n.flags|=4),n.flags&16384&&(i=n.tag!==22?At():536870912,n.lanes|=i,Jr|=i)}function _l(n,i){if(!Be)switch(n.tailMode){case"hidden":i=n.tail;for(var r=null;i!==null;)i.alternate!==null&&(r=i),i=i.sibling;r===null?n.tail=null:r.sibling=null;break;case"collapsed":r=n.tail;for(var c=null;r!==null;)r.alternate!==null&&(c=r),r=r.sibling;c===null?i||n.tail===null?n.tail=null:n.tail.sibling=null:c.sibling=null}}function ln(n){var i=n.alternate!==null&&n.alternate.child===n.child,r=0,c=0;if(i)for(var f=n.child;f!==null;)r|=f.lanes|f.childLanes,c|=f.subtreeFlags&65011712,c|=f.flags&65011712,f.return=n,f=f.sibling;else for(f=n.child;f!==null;)r|=f.lanes|f.childLanes,c|=f.subtreeFlags,c|=f.flags,f.return=n,f=f.sibling;return n.subtreeFlags|=c,n.childLanes=r,i}function BM(n,i,r){var c=i.pendingProps;switch(Kf(i),i.tag){case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return ln(i),null;case 1:return ln(i),null;case 3:return r=i.stateNode,c=null,n!==null&&(c=n.memoizedState.cache),i.memoizedState.cache!==c&&(i.flags|=2048),Ta(En),zt(),r.pendingContext&&(r.context=r.pendingContext,r.pendingContext=null),(n===null||n.child===null)&&(Ir(i)?Ca(i):n===null||n.memoizedState.isDehydrated&&(i.flags&256)===0||(i.flags|=1024,Qf())),ln(i),null;case 26:var f=i.type,m=i.memoizedState;return n===null?(Ca(i),m!==null?(ln(i),gv(i,m)):(ln(i),Gh(i,f,null,c,r))):m?m!==n.memoizedState?(Ca(i),ln(i),gv(i,m)):(ln(i),i.flags&=-16777217):(n=n.memoizedProps,n!==c&&Ca(i),ln(i),Gh(i,f,n,c,r)),null;case 27:if(ae(i),r=et.current,f=i.type,n!==null&&i.stateNode!=null)n.memoizedProps!==c&&Ca(i);else{if(!c){if(i.stateNode===null)throw Error(a(166));return ln(i),null}n=Ct.current,Ir(i)?Kg(i):(n=b_(f,c,r),i.stateNode=n,Ca(i))}return ln(i),null;case 5:if(ae(i),f=i.type,n!==null&&i.stateNode!=null)n.memoizedProps!==c&&Ca(i);else{if(!c){if(i.stateNode===null)throw Error(a(166));return ln(i),null}if(m=Ct.current,Ir(i))Kg(i);else{var S=hu(et.current);switch(m){case 1:m=S.createElementNS("http://www.w3.org/2000/svg",f);break;case 2:m=S.createElementNS("http://www.w3.org/1998/Math/MathML",f);break;default:switch(f){case"svg":m=S.createElementNS("http://www.w3.org/2000/svg",f);break;case"math":m=S.createElementNS("http://www.w3.org/1998/Math/MathML",f);break;case"script":m=S.createElement("div"),m.innerHTML="<script><\/script>",m=m.removeChild(m.firstChild);break;case"select":m=typeof c.is=="string"?S.createElement("select",{is:c.is}):S.createElement("select"),c.multiple?m.multiple=!0:c.size&&(m.size=c.size);break;default:m=typeof c.is=="string"?S.createElement(f,{is:c.is}):S.createElement(f)}}m[Mn]=i,m[zn]=c;t:for(S=i.child;S!==null;){if(S.tag===5||S.tag===6)m.appendChild(S.stateNode);else if(S.tag!==4&&S.tag!==27&&S.child!==null){S.child.return=S,S=S.child;continue}if(S===i)break t;for(;S.sibling===null;){if(S.return===null||S.return===i)break t;S=S.return}S.sibling.return=S.return,S=S.sibling}i.stateNode=m;t:switch(Vn(m,f,c),f){case"button":case"input":case"select":case"textarea":c=!!c.autoFocus;break t;case"img":c=!0;break t;default:c=!1}c&&Ca(i)}}return ln(i),Gh(i,i.type,n===null?null:n.memoizedProps,i.pendingProps,r),null;case 6:if(n&&i.stateNode!=null)n.memoizedProps!==c&&Ca(i);else{if(typeof c!="string"&&i.stateNode===null)throw Error(a(166));if(n=et.current,Ir(i)){if(n=i.stateNode,r=i.memoizedProps,c=null,f=Fn,f!==null)switch(f.tag){case 27:case 5:c=f.memoizedProps}n[Mn]=i,n=!!(n.nodeValue===r||c!==null&&c.suppressHydrationWarning===!0||h_(n.nodeValue,r)),n||ls(i,!0)}else n=hu(n).createTextNode(c),n[Mn]=i,i.stateNode=n}return ln(i),null;case 31:if(r=i.memoizedState,n===null||n.memoizedState!==null){if(c=Ir(i),r!==null){if(n===null){if(!c)throw Error(a(318));if(n=i.memoizedState,n=n!==null?n.dehydrated:null,!n)throw Error(a(557));n[Mn]=i}else Qs(),(i.flags&128)===0&&(i.memoizedState=null),i.flags|=4;ln(i),n=!1}else r=Qf(),n!==null&&n.memoizedState!==null&&(n.memoizedState.hydrationErrors=r),n=!0;if(!n)return i.flags&256?(bi(i),i):(bi(i),null);if((i.flags&128)!==0)throw Error(a(558))}return ln(i),null;case 13:if(c=i.memoizedState,n===null||n.memoizedState!==null&&n.memoizedState.dehydrated!==null){if(f=Ir(i),c!==null&&c.dehydrated!==null){if(n===null){if(!f)throw Error(a(318));if(f=i.memoizedState,f=f!==null?f.dehydrated:null,!f)throw Error(a(317));f[Mn]=i}else Qs(),(i.flags&128)===0&&(i.memoizedState=null),i.flags|=4;ln(i),f=!1}else f=Qf(),n!==null&&n.memoizedState!==null&&(n.memoizedState.hydrationErrors=f),f=!0;if(!f)return i.flags&256?(bi(i),i):(bi(i),null)}return bi(i),(i.flags&128)!==0?(i.lanes=r,i):(r=c!==null,n=n!==null&&n.memoizedState!==null,r&&(c=i.child,f=null,c.alternate!==null&&c.alternate.memoizedState!==null&&c.alternate.memoizedState.cachePool!==null&&(f=c.alternate.memoizedState.cachePool.pool),m=null,c.memoizedState!==null&&c.memoizedState.cachePool!==null&&(m=c.memoizedState.cachePool.pool),m!==f&&(c.flags|=2048)),r!==n&&r&&(i.child.flags|=8192),Qc(i,i.updateQueue),ln(i),null);case 4:return zt(),n===null&&cd(i.stateNode.containerInfo),ln(i),null;case 10:return Ta(i.type),ln(i),null;case 19:if(X(xn),c=i.memoizedState,c===null)return ln(i),null;if(f=(i.flags&128)!==0,m=c.rendering,m===null)if(f)_l(c,!1);else{if(_n!==0||n!==null&&(n.flags&128)!==0)for(n=i.child;n!==null;){if(m=zc(n),m!==null){for(i.flags|=128,_l(c,!1),n=m.updateQueue,i.updateQueue=n,Qc(i,n),i.subtreeFlags=0,n=r,r=i.child;r!==null;)Xg(r,n),r=r.sibling;return _t(xn,xn.current&1|2),Be&&ba(i,c.treeForkCount),i.child}n=n.sibling}c.tail!==null&&Me()>nu&&(i.flags|=128,f=!0,_l(c,!1),i.lanes=4194304)}else{if(!f)if(n=zc(m),n!==null){if(i.flags|=128,f=!0,n=n.updateQueue,i.updateQueue=n,Qc(i,n),_l(c,!0),c.tail===null&&c.tailMode==="hidden"&&!m.alternate&&!Be)return ln(i),null}else 2*Me()-c.renderingStartTime>nu&&r!==536870912&&(i.flags|=128,f=!0,_l(c,!1),i.lanes=4194304);c.isBackwards?(m.sibling=i.child,i.child=m):(n=c.last,n!==null?n.sibling=m:i.child=m,c.last=m)}return c.tail!==null?(n=c.tail,c.rendering=n,c.tail=n.sibling,c.renderingStartTime=Me(),n.sibling=null,r=xn.current,_t(xn,f?r&1|2:r&1),Be&&ba(i,c.treeForkCount),n):(ln(i),null);case 22:case 23:return bi(i),uh(),c=i.memoizedState!==null,n!==null?n.memoizedState!==null!==c&&(i.flags|=8192):c&&(i.flags|=8192),c?(r&536870912)!==0&&(i.flags&128)===0&&(ln(i),i.subtreeFlags&6&&(i.flags|=8192)):ln(i),r=i.updateQueue,r!==null&&Qc(i,r.retryQueue),r=null,n!==null&&n.memoizedState!==null&&n.memoizedState.cachePool!==null&&(r=n.memoizedState.cachePool.pool),c=null,i.memoizedState!==null&&i.memoizedState.cachePool!==null&&(c=i.memoizedState.cachePool.pool),c!==r&&(i.flags|=2048),n!==null&&X(tr),null;case 24:return r=null,n!==null&&(r=n.memoizedState.cache),i.memoizedState.cache!==r&&(i.flags|=2048),Ta(En),ln(i),null;case 25:return null;case 30:return null}throw Error(a(156,i.tag))}function IM(n,i){switch(Kf(i),i.tag){case 1:return n=i.flags,n&65536?(i.flags=n&-65537|128,i):null;case 3:return Ta(En),zt(),n=i.flags,(n&65536)!==0&&(n&128)===0?(i.flags=n&-65537|128,i):null;case 26:case 27:case 5:return ae(i),null;case 31:if(i.memoizedState!==null){if(bi(i),i.alternate===null)throw Error(a(340));Qs()}return n=i.flags,n&65536?(i.flags=n&-65537|128,i):null;case 13:if(bi(i),n=i.memoizedState,n!==null&&n.dehydrated!==null){if(i.alternate===null)throw Error(a(340));Qs()}return n=i.flags,n&65536?(i.flags=n&-65537|128,i):null;case 19:return X(xn),null;case 4:return zt(),null;case 10:return Ta(i.type),null;case 22:case 23:return bi(i),uh(),n!==null&&X(tr),n=i.flags,n&65536?(i.flags=n&-65537|128,i):null;case 24:return Ta(En),null;case 25:return null;default:return null}}function vv(n,i){switch(Kf(i),i.tag){case 3:Ta(En),zt();break;case 26:case 27:case 5:ae(i);break;case 4:zt();break;case 31:i.memoizedState!==null&&bi(i);break;case 13:bi(i);break;case 19:X(xn);break;case 10:Ta(i.type);break;case 22:case 23:bi(i),uh(),n!==null&&X(tr);break;case 24:Ta(En)}}function xl(n,i){try{var r=i.updateQueue,c=r!==null?r.lastEffect:null;if(c!==null){var f=c.next;r=f;do{if((r.tag&n)===n){c=void 0;var m=r.create,S=r.inst;c=m(),S.destroy=c}r=r.next}while(r!==f)}}catch(R){Ke(i,i.return,R)}}function ms(n,i,r){try{var c=i.updateQueue,f=c!==null?c.lastEffect:null;if(f!==null){var m=f.next;c=m;do{if((c.tag&n)===n){var S=c.inst,R=S.destroy;if(R!==void 0){S.destroy=void 0,f=i;var G=r,at=R;try{at()}catch(xt){Ke(f,G,xt)}}}c=c.next}while(c!==m)}}catch(xt){Ke(i,i.return,xt)}}function _v(n){var i=n.updateQueue;if(i!==null){var r=n.stateNode;try{l0(i,r)}catch(c){Ke(n,n.return,c)}}}function xv(n,i,r){r.props=sr(n.type,n.memoizedProps),r.state=n.memoizedState;try{r.componentWillUnmount()}catch(c){Ke(n,i,c)}}function yl(n,i){try{var r=n.ref;if(r!==null){switch(n.tag){case 26:case 27:case 5:var c=n.stateNode;break;case 30:c=n.stateNode;break;default:c=n.stateNode}typeof r=="function"?n.refCleanup=r(c):r.current=c}}catch(f){Ke(n,i,f)}}function ra(n,i){var r=n.ref,c=n.refCleanup;if(r!==null)if(typeof c=="function")try{c()}catch(f){Ke(n,i,f)}finally{n.refCleanup=null,n=n.alternate,n!=null&&(n.refCleanup=null)}else if(typeof r=="function")try{r(null)}catch(f){Ke(n,i,f)}else r.current=null}function yv(n){var i=n.type,r=n.memoizedProps,c=n.stateNode;try{t:switch(i){case"button":case"input":case"select":case"textarea":r.autoFocus&&c.focus();break t;case"img":r.src?c.src=r.src:r.srcSet&&(c.srcset=r.srcSet)}}catch(f){Ke(n,n.return,f)}}function Vh(n,i,r){try{var c=n.stateNode;sb(c,n.type,r,i),c[zn]=i}catch(f){Ke(n,n.return,f)}}function Sv(n){return n.tag===5||n.tag===3||n.tag===26||n.tag===27&&Ms(n.type)||n.tag===4}function kh(n){t:for(;;){for(;n.sibling===null;){if(n.return===null||Sv(n.return))return null;n=n.return}for(n.sibling.return=n.return,n=n.sibling;n.tag!==5&&n.tag!==6&&n.tag!==18;){if(n.tag===27&&Ms(n.type)||n.flags&2||n.child===null||n.tag===4)continue t;n.child.return=n,n=n.child}if(!(n.flags&2))return n.stateNode}}function Xh(n,i,r){var c=n.tag;if(c===5||c===6)n=n.stateNode,i?(r.nodeType===9?r.body:r.nodeName==="HTML"?r.ownerDocument.body:r).insertBefore(n,i):(i=r.nodeType===9?r.body:r.nodeName==="HTML"?r.ownerDocument.body:r,i.appendChild(n),r=r._reactRootContainer,r!=null||i.onclick!==null||(i.onclick=ya));else if(c!==4&&(c===27&&Ms(n.type)&&(r=n.stateNode,i=null),n=n.child,n!==null))for(Xh(n,i,r),n=n.sibling;n!==null;)Xh(n,i,r),n=n.sibling}function $c(n,i,r){var c=n.tag;if(c===5||c===6)n=n.stateNode,i?r.insertBefore(n,i):r.appendChild(n);else if(c!==4&&(c===27&&Ms(n.type)&&(r=n.stateNode),n=n.child,n!==null))for($c(n,i,r),n=n.sibling;n!==null;)$c(n,i,r),n=n.sibling}function Mv(n){var i=n.stateNode,r=n.memoizedProps;try{for(var c=n.type,f=i.attributes;f.length;)i.removeAttributeNode(f[0]);Vn(i,c,r),i[Mn]=n,i[zn]=r}catch(m){Ke(n,n.return,m)}}var Da=!1,wn=!1,Wh=!1,bv=typeof WeakSet=="function"?WeakSet:Set,Pn=null;function zM(n,i){if(n=n.containerInfo,hd=xu,n=Pg(n),zf(n)){if("selectionStart"in n)var r={start:n.selectionStart,end:n.selectionEnd};else t:{r=(r=n.ownerDocument)&&r.defaultView||window;var c=r.getSelection&&r.getSelection();if(c&&c.rangeCount!==0){r=c.anchorNode;var f=c.anchorOffset,m=c.focusNode;c=c.focusOffset;try{r.nodeType,m.nodeType}catch{r=null;break t}var S=0,R=-1,G=-1,at=0,xt=0,bt=n,ct=null;e:for(;;){for(var ht;bt!==r||f!==0&&bt.nodeType!==3||(R=S+f),bt!==m||c!==0&&bt.nodeType!==3||(G=S+c),bt.nodeType===3&&(S+=bt.nodeValue.length),(ht=bt.firstChild)!==null;)ct=bt,bt=ht;for(;;){if(bt===n)break e;if(ct===r&&++at===f&&(R=S),ct===m&&++xt===c&&(G=S),(ht=bt.nextSibling)!==null)break;bt=ct,ct=bt.parentNode}bt=ht}r=R===-1||G===-1?null:{start:R,end:G}}else r=null}r=r||{start:0,end:0}}else r=null;for(dd={focusedElem:n,selectionRange:r},xu=!1,Pn=i;Pn!==null;)if(i=Pn,n=i.child,(i.subtreeFlags&1028)!==0&&n!==null)n.return=i,Pn=n;else for(;Pn!==null;){switch(i=Pn,m=i.alternate,n=i.flags,i.tag){case 0:if((n&4)!==0&&(n=i.updateQueue,n=n!==null?n.events:null,n!==null))for(r=0;r<n.length;r++)f=n[r],f.ref.impl=f.nextImpl;break;case 11:case 15:break;case 1:if((n&1024)!==0&&m!==null){n=void 0,r=i,f=m.memoizedProps,m=m.memoizedState,c=r.stateNode;try{var te=sr(r.type,f);n=c.getSnapshotBeforeUpdate(te,m),c.__reactInternalSnapshotBeforeUpdate=n}catch(de){Ke(r,r.return,de)}}break;case 3:if((n&1024)!==0){if(n=i.stateNode.containerInfo,r=n.nodeType,r===9)gd(n);else if(r===1)switch(n.nodeName){case"HEAD":case"HTML":case"BODY":gd(n);break;default:n.textContent=""}}break;case 5:case 26:case 27:case 6:case 4:case 17:break;default:if((n&1024)!==0)throw Error(a(163))}if(n=i.sibling,n!==null){n.return=i.return,Pn=n;break}Pn=i.return}}function Ev(n,i,r){var c=r.flags;switch(r.tag){case 0:case 11:case 15:La(n,r),c&4&&xl(5,r);break;case 1:if(La(n,r),c&4)if(n=r.stateNode,i===null)try{n.componentDidMount()}catch(S){Ke(r,r.return,S)}else{var f=sr(r.type,i.memoizedProps);i=i.memoizedState;try{n.componentDidUpdate(f,i,n.__reactInternalSnapshotBeforeUpdate)}catch(S){Ke(r,r.return,S)}}c&64&&_v(r),c&512&&yl(r,r.return);break;case 3:if(La(n,r),c&64&&(n=r.updateQueue,n!==null)){if(i=null,r.child!==null)switch(r.child.tag){case 27:case 5:i=r.child.stateNode;break;case 1:i=r.child.stateNode}try{l0(n,i)}catch(S){Ke(r,r.return,S)}}break;case 27:i===null&&c&4&&Mv(r);case 26:case 5:La(n,r),i===null&&c&4&&yv(r),c&512&&yl(r,r.return);break;case 12:La(n,r);break;case 31:La(n,r),c&4&&wv(n,r);break;case 13:La(n,r),c&4&&Rv(n,r),c&64&&(n=r.memoizedState,n!==null&&(n=n.dehydrated,n!==null&&(r=YM.bind(null,r),db(n,r))));break;case 22:if(c=r.memoizedState!==null||Da,!c){i=i!==null&&i.memoizedState!==null||wn,f=Da;var m=wn;Da=c,(wn=i)&&!m?Na(n,r,(r.subtreeFlags&8772)!==0):La(n,r),Da=f,wn=m}break;case 30:break;default:La(n,r)}}function Tv(n){var i=n.alternate;i!==null&&(n.alternate=null,Tv(i)),n.child=null,n.deletions=null,n.sibling=null,n.tag===5&&(i=n.stateNode,i!==null&&ns(i)),n.stateNode=null,n.return=null,n.dependencies=null,n.memoizedProps=null,n.memoizedState=null,n.pendingProps=null,n.stateNode=null,n.updateQueue=null}var hn=null,fi=!1;function Ua(n,i,r){for(r=r.child;r!==null;)Av(n,i,r),r=r.sibling}function Av(n,i,r){if(vt&&typeof vt.onCommitFiberUnmount=="function")try{vt.onCommitFiberUnmount(pt,r)}catch{}switch(r.tag){case 26:wn||ra(r,i),Ua(n,i,r),r.memoizedState?r.memoizedState.count--:r.stateNode&&(r=r.stateNode,r.parentNode.removeChild(r));break;case 27:wn||ra(r,i);var c=hn,f=fi;Ms(r.type)&&(hn=r.stateNode,fi=!1),Ua(n,i,r),Cl(r.stateNode),hn=c,fi=f;break;case 5:wn||ra(r,i);case 6:if(c=hn,f=fi,hn=null,Ua(n,i,r),hn=c,fi=f,hn!==null)if(fi)try{(hn.nodeType===9?hn.body:hn.nodeName==="HTML"?hn.ownerDocument.body:hn).removeChild(r.stateNode)}catch(m){Ke(r,i,m)}else try{hn.removeChild(r.stateNode)}catch(m){Ke(r,i,m)}break;case 18:hn!==null&&(fi?(n=hn,__(n.nodeType===9?n.body:n.nodeName==="HTML"?n.ownerDocument.body:n,r.stateNode),ao(n)):__(hn,r.stateNode));break;case 4:c=hn,f=fi,hn=r.stateNode.containerInfo,fi=!0,Ua(n,i,r),hn=c,fi=f;break;case 0:case 11:case 14:case 15:ms(2,r,i),wn||ms(4,r,i),Ua(n,i,r);break;case 1:wn||(ra(r,i),c=r.stateNode,typeof c.componentWillUnmount=="function"&&xv(r,i,c)),Ua(n,i,r);break;case 21:Ua(n,i,r);break;case 22:wn=(c=wn)||r.memoizedState!==null,Ua(n,i,r),wn=c;break;default:Ua(n,i,r)}}function wv(n,i){if(i.memoizedState===null&&(n=i.alternate,n!==null&&(n=n.memoizedState,n!==null))){n=n.dehydrated;try{ao(n)}catch(r){Ke(i,i.return,r)}}}function Rv(n,i){if(i.memoizedState===null&&(n=i.alternate,n!==null&&(n=n.memoizedState,n!==null&&(n=n.dehydrated,n!==null))))try{ao(n)}catch(r){Ke(i,i.return,r)}}function FM(n){switch(n.tag){case 31:case 13:case 19:var i=n.stateNode;return i===null&&(i=n.stateNode=new bv),i;case 22:return n=n.stateNode,i=n._retryCache,i===null&&(i=n._retryCache=new bv),i;default:throw Error(a(435,n.tag))}}function jc(n,i){var r=FM(n);i.forEach(function(c){if(!r.has(c)){r.add(c);var f=ZM.bind(null,n,c);c.then(f,f)}})}function hi(n,i){var r=i.deletions;if(r!==null)for(var c=0;c<r.length;c++){var f=r[c],m=n,S=i,R=S;t:for(;R!==null;){switch(R.tag){case 27:if(Ms(R.type)){hn=R.stateNode,fi=!1;break t}break;case 5:hn=R.stateNode,fi=!1;break t;case 3:case 4:hn=R.stateNode.containerInfo,fi=!0;break t}R=R.return}if(hn===null)throw Error(a(160));Av(m,S,f),hn=null,fi=!1,m=f.alternate,m!==null&&(m.return=null),f.return=null}if(i.subtreeFlags&13886)for(i=i.child;i!==null;)Cv(i,n),i=i.sibling}var Yi=null;function Cv(n,i){var r=n.alternate,c=n.flags;switch(n.tag){case 0:case 11:case 14:case 15:hi(i,n),di(n),c&4&&(ms(3,n,n.return),xl(3,n),ms(5,n,n.return));break;case 1:hi(i,n),di(n),c&512&&(wn||r===null||ra(r,r.return)),c&64&&Da&&(n=n.updateQueue,n!==null&&(c=n.callbacks,c!==null&&(r=n.shared.hiddenCallbacks,n.shared.hiddenCallbacks=r===null?c:r.concat(c))));break;case 26:var f=Yi;if(hi(i,n),di(n),c&512&&(wn||r===null||ra(r,r.return)),c&4){var m=r!==null?r.memoizedState:null;if(c=n.memoizedState,r===null)if(c===null)if(n.stateNode===null){t:{c=n.type,r=n.memoizedProps,f=f.ownerDocument||f;e:switch(c){case"title":m=f.getElementsByTagName("title")[0],(!m||m[es]||m[Mn]||m.namespaceURI==="http://www.w3.org/2000/svg"||m.hasAttribute("itemprop"))&&(m=f.createElement(c),f.head.insertBefore(m,f.querySelector("head > title"))),Vn(m,c,r),m[Mn]=n,bn(m),c=m;break t;case"link":var S=C_("link","href",f).get(c+(r.href||""));if(S){for(var R=0;R<S.length;R++)if(m=S[R],m.getAttribute("href")===(r.href==null||r.href===""?null:r.href)&&m.getAttribute("rel")===(r.rel==null?null:r.rel)&&m.getAttribute("title")===(r.title==null?null:r.title)&&m.getAttribute("crossorigin")===(r.crossOrigin==null?null:r.crossOrigin)){S.splice(R,1);break e}}m=f.createElement(c),Vn(m,c,r),f.head.appendChild(m);break;case"meta":if(S=C_("meta","content",f).get(c+(r.content||""))){for(R=0;R<S.length;R++)if(m=S[R],m.getAttribute("content")===(r.content==null?null:""+r.content)&&m.getAttribute("name")===(r.name==null?null:r.name)&&m.getAttribute("property")===(r.property==null?null:r.property)&&m.getAttribute("http-equiv")===(r.httpEquiv==null?null:r.httpEquiv)&&m.getAttribute("charset")===(r.charSet==null?null:r.charSet)){S.splice(R,1);break e}}m=f.createElement(c),Vn(m,c,r),f.head.appendChild(m);break;default:throw Error(a(468,c))}m[Mn]=n,bn(m),c=m}n.stateNode=c}else D_(f,n.type,n.stateNode);else n.stateNode=R_(f,c,n.memoizedProps);else m!==c?(m===null?r.stateNode!==null&&(r=r.stateNode,r.parentNode.removeChild(r)):m.count--,c===null?D_(f,n.type,n.stateNode):R_(f,c,n.memoizedProps)):c===null&&n.stateNode!==null&&Vh(n,n.memoizedProps,r.memoizedProps)}break;case 27:hi(i,n),di(n),c&512&&(wn||r===null||ra(r,r.return)),r!==null&&c&4&&Vh(n,n.memoizedProps,r.memoizedProps);break;case 5:if(hi(i,n),di(n),c&512&&(wn||r===null||ra(r,r.return)),n.flags&32){f=n.stateNode;try{xi(f,"")}catch(te){Ke(n,n.return,te)}}c&4&&n.stateNode!=null&&(f=n.memoizedProps,Vh(n,f,r!==null?r.memoizedProps:f)),c&1024&&(Wh=!0);break;case 6:if(hi(i,n),di(n),c&4){if(n.stateNode===null)throw Error(a(162));c=n.memoizedProps,r=n.stateNode;try{r.nodeValue=c}catch(te){Ke(n,n.return,te)}}break;case 3:if(mu=null,f=Yi,Yi=du(i.containerInfo),hi(i,n),Yi=f,di(n),c&4&&r!==null&&r.memoizedState.isDehydrated)try{ao(i.containerInfo)}catch(te){Ke(n,n.return,te)}Wh&&(Wh=!1,Dv(n));break;case 4:c=Yi,Yi=du(n.stateNode.containerInfo),hi(i,n),di(n),Yi=c;break;case 12:hi(i,n),di(n);break;case 31:hi(i,n),di(n),c&4&&(c=n.updateQueue,c!==null&&(n.updateQueue=null,jc(n,c)));break;case 13:hi(i,n),di(n),n.child.flags&8192&&n.memoizedState!==null!=(r!==null&&r.memoizedState!==null)&&(eu=Me()),c&4&&(c=n.updateQueue,c!==null&&(n.updateQueue=null,jc(n,c)));break;case 22:f=n.memoizedState!==null;var G=r!==null&&r.memoizedState!==null,at=Da,xt=wn;if(Da=at||f,wn=xt||G,hi(i,n),wn=xt,Da=at,di(n),c&8192)t:for(i=n.stateNode,i._visibility=f?i._visibility&-2:i._visibility|1,f&&(r===null||G||Da||wn||rr(n)),r=null,i=n;;){if(i.tag===5||i.tag===26){if(r===null){G=r=i;try{if(m=G.stateNode,f)S=m.style,typeof S.setProperty=="function"?S.setProperty("display","none","important"):S.display="none";else{R=G.stateNode;var bt=G.memoizedProps.style,ct=bt!=null&&bt.hasOwnProperty("display")?bt.display:null;R.style.display=ct==null||typeof ct=="boolean"?"":(""+ct).trim()}}catch(te){Ke(G,G.return,te)}}}else if(i.tag===6){if(r===null){G=i;try{G.stateNode.nodeValue=f?"":G.memoizedProps}catch(te){Ke(G,G.return,te)}}}else if(i.tag===18){if(r===null){G=i;try{var ht=G.stateNode;f?x_(ht,!0):x_(G.stateNode,!1)}catch(te){Ke(G,G.return,te)}}}else if((i.tag!==22&&i.tag!==23||i.memoizedState===null||i===n)&&i.child!==null){i.child.return=i,i=i.child;continue}if(i===n)break t;for(;i.sibling===null;){if(i.return===null||i.return===n)break t;r===i&&(r=null),i=i.return}r===i&&(r=null),i.sibling.return=i.return,i=i.sibling}c&4&&(c=n.updateQueue,c!==null&&(r=c.retryQueue,r!==null&&(c.retryQueue=null,jc(n,r))));break;case 19:hi(i,n),di(n),c&4&&(c=n.updateQueue,c!==null&&(n.updateQueue=null,jc(n,c)));break;case 30:break;case 21:break;default:hi(i,n),di(n)}}function di(n){var i=n.flags;if(i&2){try{for(var r,c=n.return;c!==null;){if(Sv(c)){r=c;break}c=c.return}if(r==null)throw Error(a(160));switch(r.tag){case 27:var f=r.stateNode,m=kh(n);$c(n,m,f);break;case 5:var S=r.stateNode;r.flags&32&&(xi(S,""),r.flags&=-33);var R=kh(n);$c(n,R,S);break;case 3:case 4:var G=r.stateNode.containerInfo,at=kh(n);Xh(n,at,G);break;default:throw Error(a(161))}}catch(xt){Ke(n,n.return,xt)}n.flags&=-3}i&4096&&(n.flags&=-4097)}function Dv(n){if(n.subtreeFlags&1024)for(n=n.child;n!==null;){var i=n;Dv(i),i.tag===5&&i.flags&1024&&i.stateNode.reset(),n=n.sibling}}function La(n,i){if(i.subtreeFlags&8772)for(i=i.child;i!==null;)Ev(n,i.alternate,i),i=i.sibling}function rr(n){for(n=n.child;n!==null;){var i=n;switch(i.tag){case 0:case 11:case 14:case 15:ms(4,i,i.return),rr(i);break;case 1:ra(i,i.return);var r=i.stateNode;typeof r.componentWillUnmount=="function"&&xv(i,i.return,r),rr(i);break;case 27:Cl(i.stateNode);case 26:case 5:ra(i,i.return),rr(i);break;case 22:i.memoizedState===null&&rr(i);break;case 30:rr(i);break;default:rr(i)}n=n.sibling}}function Na(n,i,r){for(r=r&&(i.subtreeFlags&8772)!==0,i=i.child;i!==null;){var c=i.alternate,f=n,m=i,S=m.flags;switch(m.tag){case 0:case 11:case 15:Na(f,m,r),xl(4,m);break;case 1:if(Na(f,m,r),c=m,f=c.stateNode,typeof f.componentDidMount=="function")try{f.componentDidMount()}catch(at){Ke(c,c.return,at)}if(c=m,f=c.updateQueue,f!==null){var R=c.stateNode;try{var G=f.shared.hiddenCallbacks;if(G!==null)for(f.shared.hiddenCallbacks=null,f=0;f<G.length;f++)o0(G[f],R)}catch(at){Ke(c,c.return,at)}}r&&S&64&&_v(m),yl(m,m.return);break;case 27:Mv(m);case 26:case 5:Na(f,m,r),r&&c===null&&S&4&&yv(m),yl(m,m.return);break;case 12:Na(f,m,r);break;case 31:Na(f,m,r),r&&S&4&&wv(f,m);break;case 13:Na(f,m,r),r&&S&4&&Rv(f,m);break;case 22:m.memoizedState===null&&Na(f,m,r),yl(m,m.return);break;case 30:break;default:Na(f,m,r)}i=i.sibling}}function qh(n,i){var r=null;n!==null&&n.memoizedState!==null&&n.memoizedState.cachePool!==null&&(r=n.memoizedState.cachePool.pool),n=null,i.memoizedState!==null&&i.memoizedState.cachePool!==null&&(n=i.memoizedState.cachePool.pool),n!==r&&(n!=null&&n.refCount++,r!=null&&rl(r))}function Yh(n,i){n=null,i.alternate!==null&&(n=i.alternate.memoizedState.cache),i=i.memoizedState.cache,i!==n&&(i.refCount++,n!=null&&rl(n))}function Zi(n,i,r,c){if(i.subtreeFlags&10256)for(i=i.child;i!==null;)Uv(n,i,r,c),i=i.sibling}function Uv(n,i,r,c){var f=i.flags;switch(i.tag){case 0:case 11:case 15:Zi(n,i,r,c),f&2048&&xl(9,i);break;case 1:Zi(n,i,r,c);break;case 3:Zi(n,i,r,c),f&2048&&(n=null,i.alternate!==null&&(n=i.alternate.memoizedState.cache),i=i.memoizedState.cache,i!==n&&(i.refCount++,n!=null&&rl(n)));break;case 12:if(f&2048){Zi(n,i,r,c),n=i.stateNode;try{var m=i.memoizedProps,S=m.id,R=m.onPostCommit;typeof R=="function"&&R(S,i.alternate===null?"mount":"update",n.passiveEffectDuration,-0)}catch(G){Ke(i,i.return,G)}}else Zi(n,i,r,c);break;case 31:Zi(n,i,r,c);break;case 13:Zi(n,i,r,c);break;case 23:break;case 22:m=i.stateNode,S=i.alternate,i.memoizedState!==null?m._visibility&2?Zi(n,i,r,c):Sl(n,i):m._visibility&2?Zi(n,i,r,c):(m._visibility|=2,Yr(n,i,r,c,(i.subtreeFlags&10256)!==0||!1)),f&2048&&qh(S,i);break;case 24:Zi(n,i,r,c),f&2048&&Yh(i.alternate,i);break;default:Zi(n,i,r,c)}}function Yr(n,i,r,c,f){for(f=f&&((i.subtreeFlags&10256)!==0||!1),i=i.child;i!==null;){var m=n,S=i,R=r,G=c,at=S.flags;switch(S.tag){case 0:case 11:case 15:Yr(m,S,R,G,f),xl(8,S);break;case 23:break;case 22:var xt=S.stateNode;S.memoizedState!==null?xt._visibility&2?Yr(m,S,R,G,f):Sl(m,S):(xt._visibility|=2,Yr(m,S,R,G,f)),f&&at&2048&&qh(S.alternate,S);break;case 24:Yr(m,S,R,G,f),f&&at&2048&&Yh(S.alternate,S);break;default:Yr(m,S,R,G,f)}i=i.sibling}}function Sl(n,i){if(i.subtreeFlags&10256)for(i=i.child;i!==null;){var r=n,c=i,f=c.flags;switch(c.tag){case 22:Sl(r,c),f&2048&&qh(c.alternate,c);break;case 24:Sl(r,c),f&2048&&Yh(c.alternate,c);break;default:Sl(r,c)}i=i.sibling}}var Ml=8192;function Zr(n,i,r){if(n.subtreeFlags&Ml)for(n=n.child;n!==null;)Lv(n,i,r),n=n.sibling}function Lv(n,i,r){switch(n.tag){case 26:Zr(n,i,r),n.flags&Ml&&n.memoizedState!==null&&Tb(r,Yi,n.memoizedState,n.memoizedProps);break;case 5:Zr(n,i,r);break;case 3:case 4:var c=Yi;Yi=du(n.stateNode.containerInfo),Zr(n,i,r),Yi=c;break;case 22:n.memoizedState===null&&(c=n.alternate,c!==null&&c.memoizedState!==null?(c=Ml,Ml=16777216,Zr(n,i,r),Ml=c):Zr(n,i,r));break;default:Zr(n,i,r)}}function Nv(n){var i=n.alternate;if(i!==null&&(n=i.child,n!==null)){i.child=null;do i=n.sibling,n.sibling=null,n=i;while(n!==null)}}function bl(n){var i=n.deletions;if((n.flags&16)!==0){if(i!==null)for(var r=0;r<i.length;r++){var c=i[r];Pn=c,Pv(c,n)}Nv(n)}if(n.subtreeFlags&10256)for(n=n.child;n!==null;)Ov(n),n=n.sibling}function Ov(n){switch(n.tag){case 0:case 11:case 15:bl(n),n.flags&2048&&ms(9,n,n.return);break;case 3:bl(n);break;case 12:bl(n);break;case 22:var i=n.stateNode;n.memoizedState!==null&&i._visibility&2&&(n.return===null||n.return.tag!==13)?(i._visibility&=-3,tu(n)):bl(n);break;default:bl(n)}}function tu(n){var i=n.deletions;if((n.flags&16)!==0){if(i!==null)for(var r=0;r<i.length;r++){var c=i[r];Pn=c,Pv(c,n)}Nv(n)}for(n=n.child;n!==null;){switch(i=n,i.tag){case 0:case 11:case 15:ms(8,i,i.return),tu(i);break;case 22:r=i.stateNode,r._visibility&2&&(r._visibility&=-3,tu(i));break;default:tu(i)}n=n.sibling}}function Pv(n,i){for(;Pn!==null;){var r=Pn;switch(r.tag){case 0:case 11:case 15:ms(8,r,i);break;case 23:case 22:if(r.memoizedState!==null&&r.memoizedState.cachePool!==null){var c=r.memoizedState.cachePool.pool;c!=null&&c.refCount++}break;case 24:rl(r.memoizedState.cache)}if(c=r.child,c!==null)c.return=r,Pn=c;else t:for(r=n;Pn!==null;){c=Pn;var f=c.sibling,m=c.return;if(Tv(c),c===r){Pn=null;break t}if(f!==null){f.return=m,Pn=f;break t}Pn=m}}}var HM={getCacheForType:function(n){var i=Hn(En),r=i.data.get(n);return r===void 0&&(r=n(),i.data.set(n,r)),r},cacheSignal:function(){return Hn(En).controller.signal}},GM=typeof WeakMap=="function"?WeakMap:Map,Ve=0,an=null,Ce=null,Le=0,Ze=0,Ei=null,gs=!1,Kr=!1,Zh=!1,Oa=0,_n=0,vs=0,or=0,Kh=0,Ti=0,Jr=0,El=null,pi=null,Jh=!1,eu=0,Bv=0,nu=1/0,iu=null,_s=null,Un=0,xs=null,Qr=null,Pa=0,Qh=0,$h=null,Iv=null,Tl=0,jh=null;function Ai(){return(Ve&2)!==0&&Le!==0?Le&-Le:F.T!==null?sd():Zo()}function zv(){if(Ti===0)if((Le&536870912)===0||Be){var n=ve;ve<<=1,(ve&3932160)===0&&(ve=262144),Ti=n}else Ti=536870912;return n=Mi.current,n!==null&&(n.flags|=32),Ti}function mi(n,i,r){(n===an&&(Ze===2||Ze===9)||n.cancelPendingCommit!==null)&&($r(n,0),ys(n,Le,Ti,!1)),Qt(n,r),((Ve&2)===0||n!==an)&&(n===an&&((Ve&2)===0&&(or|=r),_n===4&&ys(n,Le,Ti,!1)),oa(n))}function Fv(n,i,r){if((Ve&6)!==0)throw Error(a(327));var c=!r&&(i&127)===0&&(i&n.expiredLanes)===0||It(n,i),f=c?XM(n,i):ed(n,i,!0),m=c;do{if(f===0){Kr&&!c&&ys(n,i,0,!1);break}else{if(r=n.current.alternate,m&&!VM(r)){f=ed(n,i,!1),m=!1;continue}if(f===2){if(m=i,n.errorRecoveryDisabledLanes&m)var S=0;else S=n.pendingLanes&-536870913,S=S!==0?S:S&536870912?536870912:0;if(S!==0){i=S;t:{var R=n;f=El;var G=R.current.memoizedState.isDehydrated;if(G&&($r(R,S).flags|=256),S=ed(R,S,!1),S!==2){if(Zh&&!G){R.errorRecoveryDisabledLanes|=m,or|=m,f=4;break t}m=pi,pi=f,m!==null&&(pi===null?pi=m:pi.push.apply(pi,m))}f=S}if(m=!1,f!==2)continue}}if(f===1){$r(n,0),ys(n,i,0,!0);break}t:{switch(c=n,m=f,m){case 0:case 1:throw Error(a(345));case 4:if((i&4194048)!==i)break;case 6:ys(c,i,Ti,!gs);break t;case 2:pi=null;break;case 3:case 5:break;default:throw Error(a(329))}if((i&62914560)===i&&(f=eu+300-Me(),10<f)){if(ys(c,i,Ti,!gs),yt(c,0,!0)!==0)break t;Pa=i,c.timeoutHandle=g_(Hv.bind(null,c,r,pi,iu,Jh,i,Ti,or,Jr,gs,m,"Throttled",-0,0),f);break t}Hv(c,r,pi,iu,Jh,i,Ti,or,Jr,gs,m,null,-0,0)}}break}while(!0);oa(n)}function Hv(n,i,r,c,f,m,S,R,G,at,xt,bt,ct,ht){if(n.timeoutHandle=-1,bt=i.subtreeFlags,bt&8192||(bt&16785408)===16785408){bt={stylesheets:null,count:0,imgCount:0,imgBytes:0,suspenseyImages:[],waitingForImages:!0,waitingForViewTransition:!1,unsuspend:ya},Lv(i,m,bt);var te=(m&62914560)===m?eu-Me():(m&4194048)===m?Bv-Me():0;if(te=Ab(bt,te),te!==null){Pa=m,n.cancelPendingCommit=te(Zv.bind(null,n,i,m,r,c,f,S,R,G,xt,bt,null,ct,ht)),ys(n,m,S,!at);return}}Zv(n,i,m,r,c,f,S,R,G)}function VM(n){for(var i=n;;){var r=i.tag;if((r===0||r===11||r===15)&&i.flags&16384&&(r=i.updateQueue,r!==null&&(r=r.stores,r!==null)))for(var c=0;c<r.length;c++){var f=r[c],m=f.getSnapshot;f=f.value;try{if(!yi(m(),f))return!1}catch{return!1}}if(r=i.child,i.subtreeFlags&16384&&r!==null)r.return=i,i=r;else{if(i===n)break;for(;i.sibling===null;){if(i.return===null||i.return===n)return!0;i=i.return}i.sibling.return=i.return,i=i.sibling}}return!0}function ys(n,i,r,c){i&=~Kh,i&=~or,n.suspendedLanes|=i,n.pingedLanes&=~i,c&&(n.warmLanes|=i),c=n.expirationTimes;for(var f=i;0<f;){var m=31-Yt(f),S=1<<m;c[m]=-1,f&=~S}r!==0&&Xe(n,r,i)}function au(){return(Ve&6)===0?(Al(0),!1):!0}function td(){if(Ce!==null){if(Ze===0)var n=Ce.return;else n=Ce,Ea=$s=null,gh(n),Vr=null,ll=0,n=Ce;for(;n!==null;)vv(n.alternate,n),n=n.return;Ce=null}}function $r(n,i){var r=n.timeoutHandle;r!==-1&&(n.timeoutHandle=-1,lb(r)),r=n.cancelPendingCommit,r!==null&&(n.cancelPendingCommit=null,r()),Pa=0,td(),an=n,Ce=r=Ma(n.current,null),Le=i,Ze=0,Ei=null,gs=!1,Kr=It(n,i),Zh=!1,Jr=Ti=Kh=or=vs=_n=0,pi=El=null,Jh=!1,(i&8)!==0&&(i|=i&32);var c=n.entangledLanes;if(c!==0)for(n=n.entanglements,c&=i;0<c;){var f=31-Yt(c),m=1<<f;i|=n[f],c&=~m}return Oa=i,Tc(),r}function Gv(n,i){Ee=null,F.H=gl,i===Gr||i===Nc?(i=i0(),Ze=3):i===ah?(i=i0(),Ze=4):Ze=i===Lh?8:i!==null&&typeof i=="object"&&typeof i.then=="function"?6:1,Ei=i,Ce===null&&(_n=1,Yc(n,Ni(i,n.current)))}function Vv(){var n=Mi.current;return n===null?!0:(Le&4194048)===Le?Ii===null:(Le&62914560)===Le||(Le&536870912)!==0?n===Ii:!1}function kv(){var n=F.H;return F.H=gl,n===null?gl:n}function Xv(){var n=F.A;return F.A=HM,n}function su(){_n=4,gs||(Le&4194048)!==Le&&Mi.current!==null||(Kr=!0),(vs&134217727)===0&&(or&134217727)===0||an===null||ys(an,Le,Ti,!1)}function ed(n,i,r){var c=Ve;Ve|=2;var f=kv(),m=Xv();(an!==n||Le!==i)&&(iu=null,$r(n,i)),i=!1;var S=_n;t:do try{if(Ze!==0&&Ce!==null){var R=Ce,G=Ei;switch(Ze){case 8:td(),S=6;break t;case 3:case 2:case 9:case 6:Mi.current===null&&(i=!0);var at=Ze;if(Ze=0,Ei=null,jr(n,R,G,at),r&&Kr){S=0;break t}break;default:at=Ze,Ze=0,Ei=null,jr(n,R,G,at)}}kM(),S=_n;break}catch(xt){Gv(n,xt)}while(!0);return i&&n.shellSuspendCounter++,Ea=$s=null,Ve=c,F.H=f,F.A=m,Ce===null&&(an=null,Le=0,Tc()),S}function kM(){for(;Ce!==null;)Wv(Ce)}function XM(n,i){var r=Ve;Ve|=2;var c=kv(),f=Xv();an!==n||Le!==i?(iu=null,nu=Me()+500,$r(n,i)):Kr=It(n,i);t:do try{if(Ze!==0&&Ce!==null){i=Ce;var m=Ei;e:switch(Ze){case 1:Ze=0,Ei=null,jr(n,i,m,1);break;case 2:case 9:if(e0(m)){Ze=0,Ei=null,qv(i);break}i=function(){Ze!==2&&Ze!==9||an!==n||(Ze=7),oa(n)},m.then(i,i);break t;case 3:Ze=7;break t;case 4:Ze=5;break t;case 7:e0(m)?(Ze=0,Ei=null,qv(i)):(Ze=0,Ei=null,jr(n,i,m,7));break;case 5:var S=null;switch(Ce.tag){case 26:S=Ce.memoizedState;case 5:case 27:var R=Ce;if(S?U_(S):R.stateNode.complete){Ze=0,Ei=null;var G=R.sibling;if(G!==null)Ce=G;else{var at=R.return;at!==null?(Ce=at,ru(at)):Ce=null}break e}}Ze=0,Ei=null,jr(n,i,m,5);break;case 6:Ze=0,Ei=null,jr(n,i,m,6);break;case 8:td(),_n=6;break t;default:throw Error(a(462))}}WM();break}catch(xt){Gv(n,xt)}while(!0);return Ea=$s=null,F.H=c,F.A=f,Ve=r,Ce!==null?0:(an=null,Le=0,Tc(),_n)}function WM(){for(;Ce!==null&&!xe();)Wv(Ce)}function Wv(n){var i=mv(n.alternate,n,Oa);n.memoizedProps=n.pendingProps,i===null?ru(n):Ce=i}function qv(n){var i=n,r=i.alternate;switch(i.tag){case 15:case 0:i=cv(r,i,i.pendingProps,i.type,void 0,Le);break;case 11:i=cv(r,i,i.pendingProps,i.type.render,i.ref,Le);break;case 5:gh(i);default:vv(r,i),i=Ce=Xg(i,Oa),i=mv(r,i,Oa)}n.memoizedProps=n.pendingProps,i===null?ru(n):Ce=i}function jr(n,i,r,c){Ea=$s=null,gh(i),Vr=null,ll=0;var f=i.return;try{if(NM(n,f,i,r,Le)){_n=1,Yc(n,Ni(r,n.current)),Ce=null;return}}catch(m){if(f!==null)throw Ce=f,m;_n=1,Yc(n,Ni(r,n.current)),Ce=null;return}i.flags&32768?(Be||c===1?n=!0:Kr||(Le&536870912)!==0?n=!1:(gs=n=!0,(c===2||c===9||c===3||c===6)&&(c=Mi.current,c!==null&&c.tag===13&&(c.flags|=16384))),Yv(i,n)):ru(i)}function ru(n){var i=n;do{if((i.flags&32768)!==0){Yv(i,gs);return}n=i.return;var r=BM(i.alternate,i,Oa);if(r!==null){Ce=r;return}if(i=i.sibling,i!==null){Ce=i;return}Ce=i=n}while(i!==null);_n===0&&(_n=5)}function Yv(n,i){do{var r=IM(n.alternate,n);if(r!==null){r.flags&=32767,Ce=r;return}if(r=n.return,r!==null&&(r.flags|=32768,r.subtreeFlags=0,r.deletions=null),!i&&(n=n.sibling,n!==null)){Ce=n;return}Ce=n=r}while(n!==null);_n=6,Ce=null}function Zv(n,i,r,c,f,m,S,R,G){n.cancelPendingCommit=null;do ou();while(Un!==0);if((Ve&6)!==0)throw Error(a(327));if(i!==null){if(i===n.current)throw Error(a(177));if(m=i.lanes|i.childLanes,m|=kf,cn(n,r,m,S,R,G),n===an&&(Ce=an=null,Le=0),Qr=i,xs=n,Pa=r,Qh=m,$h=f,Iv=c,(i.subtreeFlags&10256)!==0||(i.flags&10256)!==0?(n.callbackNode=null,n.callbackPriority=0,KM(tt,function(){return jv(),null})):(n.callbackNode=null,n.callbackPriority=0),c=(i.flags&13878)!==0,(i.subtreeFlags&13878)!==0||c){c=F.T,F.T=null,f=N.p,N.p=2,S=Ve,Ve|=4;try{zM(n,i,r)}finally{Ve=S,N.p=f,F.T=c}}Un=1,Kv(),Jv(),Qv()}}function Kv(){if(Un===1){Un=0;var n=xs,i=Qr,r=(i.flags&13878)!==0;if((i.subtreeFlags&13878)!==0||r){r=F.T,F.T=null;var c=N.p;N.p=2;var f=Ve;Ve|=4;try{Cv(i,n);var m=dd,S=Pg(n.containerInfo),R=m.focusedElem,G=m.selectionRange;if(S!==R&&R&&R.ownerDocument&&Og(R.ownerDocument.documentElement,R)){if(G!==null&&zf(R)){var at=G.start,xt=G.end;if(xt===void 0&&(xt=at),"selectionStart"in R)R.selectionStart=at,R.selectionEnd=Math.min(xt,R.value.length);else{var bt=R.ownerDocument||document,ct=bt&&bt.defaultView||window;if(ct.getSelection){var ht=ct.getSelection(),te=R.textContent.length,de=Math.min(G.start,te),je=G.end===void 0?de:Math.min(G.end,te);!ht.extend&&de>je&&(S=je,je=de,de=S);var j=Ng(R,de),Y=Ng(R,je);if(j&&Y&&(ht.rangeCount!==1||ht.anchorNode!==j.node||ht.anchorOffset!==j.offset||ht.focusNode!==Y.node||ht.focusOffset!==Y.offset)){var it=bt.createRange();it.setStart(j.node,j.offset),ht.removeAllRanges(),de>je?(ht.addRange(it),ht.extend(Y.node,Y.offset)):(it.setEnd(Y.node,Y.offset),ht.addRange(it))}}}}for(bt=[],ht=R;ht=ht.parentNode;)ht.nodeType===1&&bt.push({element:ht,left:ht.scrollLeft,top:ht.scrollTop});for(typeof R.focus=="function"&&R.focus(),R=0;R<bt.length;R++){var St=bt[R];St.element.scrollLeft=St.left,St.element.scrollTop=St.top}}xu=!!hd,dd=hd=null}finally{Ve=f,N.p=c,F.T=r}}n.current=i,Un=2}}function Jv(){if(Un===2){Un=0;var n=xs,i=Qr,r=(i.flags&8772)!==0;if((i.subtreeFlags&8772)!==0||r){r=F.T,F.T=null;var c=N.p;N.p=2;var f=Ve;Ve|=4;try{Ev(n,i.alternate,i)}finally{Ve=f,N.p=c,F.T=r}}Un=3}}function Qv(){if(Un===4||Un===3){Un=0,W();var n=xs,i=Qr,r=Pa,c=Iv;(i.subtreeFlags&10256)!==0||(i.flags&10256)!==0?Un=5:(Un=0,Qr=xs=null,$v(n,n.pendingLanes));var f=n.pendingLanes;if(f===0&&(_s=null),Yo(r),i=i.stateNode,vt&&typeof vt.onCommitFiberRoot=="function")try{vt.onCommitFiberRoot(pt,i,void 0,(i.current.flags&128)===128)}catch{}if(c!==null){i=F.T,f=N.p,N.p=2,F.T=null;try{for(var m=n.onRecoverableError,S=0;S<c.length;S++){var R=c[S];m(R.value,{componentStack:R.stack})}}finally{F.T=i,N.p=f}}(Pa&3)!==0&&ou(),oa(n),f=n.pendingLanes,(r&261930)!==0&&(f&42)!==0?n===jh?Tl++:(Tl=0,jh=n):Tl=0,Al(0)}}function $v(n,i){(n.pooledCacheLanes&=i)===0&&(i=n.pooledCache,i!=null&&(n.pooledCache=null,rl(i)))}function ou(){return Kv(),Jv(),Qv(),jv()}function jv(){if(Un!==5)return!1;var n=xs,i=Qh;Qh=0;var r=Yo(Pa),c=F.T,f=N.p;try{N.p=32>r?32:r,F.T=null,r=$h,$h=null;var m=xs,S=Pa;if(Un=0,Qr=xs=null,Pa=0,(Ve&6)!==0)throw Error(a(331));var R=Ve;if(Ve|=4,Ov(m.current),Uv(m,m.current,S,r),Ve=R,Al(0,!1),vt&&typeof vt.onPostCommitFiberRoot=="function")try{vt.onPostCommitFiberRoot(pt,m)}catch{}return!0}finally{N.p=f,F.T=c,$v(n,i)}}function t_(n,i,r){i=Ni(r,i),i=Uh(n.stateNode,i,2),n=hs(n,i,2),n!==null&&(Qt(n,2),oa(n))}function Ke(n,i,r){if(n.tag===3)t_(n,n,r);else for(;i!==null;){if(i.tag===3){t_(i,n,r);break}else if(i.tag===1){var c=i.stateNode;if(typeof i.type.getDerivedStateFromError=="function"||typeof c.componentDidCatch=="function"&&(_s===null||!_s.has(c))){n=Ni(r,n),r=ev(2),c=hs(i,r,2),c!==null&&(nv(r,c,i,n),Qt(c,2),oa(c));break}}i=i.return}}function nd(n,i,r){var c=n.pingCache;if(c===null){c=n.pingCache=new GM;var f=new Set;c.set(i,f)}else f=c.get(i),f===void 0&&(f=new Set,c.set(i,f));f.has(r)||(Zh=!0,f.add(r),n=qM.bind(null,n,i,r),i.then(n,n))}function qM(n,i,r){var c=n.pingCache;c!==null&&c.delete(i),n.pingedLanes|=n.suspendedLanes&r,n.warmLanes&=~r,an===n&&(Le&r)===r&&(_n===4||_n===3&&(Le&62914560)===Le&&300>Me()-eu?(Ve&2)===0&&$r(n,0):Kh|=r,Jr===Le&&(Jr=0)),oa(n)}function e_(n,i){i===0&&(i=At()),n=Ks(n,i),n!==null&&(Qt(n,i),oa(n))}function YM(n){var i=n.memoizedState,r=0;i!==null&&(r=i.retryLane),e_(n,r)}function ZM(n,i){var r=0;switch(n.tag){case 31:case 13:var c=n.stateNode,f=n.memoizedState;f!==null&&(r=f.retryLane);break;case 19:c=n.stateNode;break;case 22:c=n.stateNode._retryCache;break;default:throw Error(a(314))}c!==null&&c.delete(i),e_(n,r)}function KM(n,i){return ne(n,i)}var lu=null,to=null,id=!1,cu=!1,ad=!1,Ss=0;function oa(n){n!==to&&n.next===null&&(to===null?lu=to=n:to=to.next=n),cu=!0,id||(id=!0,QM())}function Al(n,i){if(!ad&&cu){ad=!0;do for(var r=!1,c=lu;c!==null;){if(n!==0){var f=c.pendingLanes;if(f===0)var m=0;else{var S=c.suspendedLanes,R=c.pingedLanes;m=(1<<31-Yt(42|n)+1)-1,m&=f&~(S&~R),m=m&201326741?m&201326741|1:m?m|2:0}m!==0&&(r=!0,s_(c,m))}else m=Le,m=yt(c,c===an?m:0,c.cancelPendingCommit!==null||c.timeoutHandle!==-1),(m&3)===0||It(c,m)||(r=!0,s_(c,m));c=c.next}while(r);ad=!1}}function JM(){n_()}function n_(){cu=id=!1;var n=0;Ss!==0&&ob()&&(n=Ss);for(var i=Me(),r=null,c=lu;c!==null;){var f=c.next,m=i_(c,i);m===0?(c.next=null,r===null?lu=f:r.next=f,f===null&&(to=r)):(r=c,(n!==0||(m&3)!==0)&&(cu=!0)),c=f}Un!==0&&Un!==5||Al(n),Ss!==0&&(Ss=0)}function i_(n,i){for(var r=n.suspendedLanes,c=n.pingedLanes,f=n.expirationTimes,m=n.pendingLanes&-62914561;0<m;){var S=31-Yt(m),R=1<<S,G=f[S];G===-1?((R&r)===0||(R&c)!==0)&&(f[S]=qt(R,i)):G<=i&&(n.expiredLanes|=R),m&=~R}if(i=an,r=Le,r=yt(n,n===i?r:0,n.cancelPendingCommit!==null||n.timeoutHandle!==-1),c=n.callbackNode,r===0||n===i&&(Ze===2||Ze===9)||n.cancelPendingCommit!==null)return c!==null&&c!==null&&he(c),n.callbackNode=null,n.callbackPriority=0;if((r&3)===0||It(n,r)){if(i=r&-r,i===n.callbackPriority)return i;switch(c!==null&&he(c),Yo(r)){case 2:case 8:r=E;break;case 32:r=tt;break;case 268435456:r=gt;break;default:r=tt}return c=a_.bind(null,n),r=ne(r,c),n.callbackPriority=i,n.callbackNode=r,i}return c!==null&&c!==null&&he(c),n.callbackPriority=2,n.callbackNode=null,2}function a_(n,i){if(Un!==0&&Un!==5)return n.callbackNode=null,n.callbackPriority=0,null;var r=n.callbackNode;if(ou()&&n.callbackNode!==r)return null;var c=Le;return c=yt(n,n===an?c:0,n.cancelPendingCommit!==null||n.timeoutHandle!==-1),c===0?null:(Fv(n,c,i),i_(n,Me()),n.callbackNode!=null&&n.callbackNode===r?a_.bind(null,n):null)}function s_(n,i){if(ou())return null;Fv(n,i,!0)}function QM(){cb(function(){(Ve&6)!==0?ne(B,JM):n_()})}function sd(){if(Ss===0){var n=Fr;n===0&&(n=ce,ce<<=1,(ce&261888)===0&&(ce=256)),Ss=n}return Ss}function r_(n){return n==null||typeof n=="symbol"||typeof n=="boolean"?null:typeof n=="function"?n:Ws(""+n)}function o_(n,i){var r=i.ownerDocument.createElement("input");return r.name=i.name,r.value=i.value,n.id&&r.setAttribute("form",n.id),i.parentNode.insertBefore(r,i),n=new FormData(n),r.parentNode.removeChild(r),n}function $M(n,i,r,c,f){if(i==="submit"&&r&&r.stateNode===f){var m=r_((f[zn]||null).action),S=c.submitter;S&&(i=(i=S[zn]||null)?r_(i.formAction):S.getAttribute("formAction"),i!==null&&(m=i,S=null));var R=new Sc("action","action",null,c,f);n.push({event:R,listeners:[{instance:null,listener:function(){if(c.defaultPrevented){if(Ss!==0){var G=S?o_(f,S):new FormData(f);Th(r,{pending:!0,data:G,method:f.method,action:m},null,G)}}else typeof m=="function"&&(R.preventDefault(),G=S?o_(f,S):new FormData(f),Th(r,{pending:!0,data:G,method:f.method,action:m},m,G))},currentTarget:f}]})}}for(var rd=0;rd<Vf.length;rd++){var od=Vf[rd],jM=od.toLowerCase(),tb=od[0].toUpperCase()+od.slice(1);qi(jM,"on"+tb)}qi(zg,"onAnimationEnd"),qi(Fg,"onAnimationIteration"),qi(Hg,"onAnimationStart"),qi("dblclick","onDoubleClick"),qi("focusin","onFocus"),qi("focusout","onBlur"),qi(gM,"onTransitionRun"),qi(vM,"onTransitionStart"),qi(_M,"onTransitionCancel"),qi(Gg,"onTransitionEnd"),lt("onMouseEnter",["mouseout","mouseover"]),lt("onMouseLeave",["mouseout","mouseover"]),lt("onPointerEnter",["pointerout","pointerover"]),lt("onPointerLeave",["pointerout","pointerover"]),Q("onChange","change click focusin focusout input keydown keyup selectionchange".split(" ")),Q("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")),Q("onBeforeInput",["compositionend","keypress","textInput","paste"]),Q("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" ")),Q("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" ")),Q("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "));var wl="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),eb=new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(wl));function l_(n,i){i=(i&4)!==0;for(var r=0;r<n.length;r++){var c=n[r],f=c.event;c=c.listeners;t:{var m=void 0;if(i)for(var S=c.length-1;0<=S;S--){var R=c[S],G=R.instance,at=R.currentTarget;if(R=R.listener,G!==m&&f.isPropagationStopped())break t;m=R,f.currentTarget=at;try{m(f)}catch(xt){Ec(xt)}f.currentTarget=null,m=G}else for(S=0;S<c.length;S++){if(R=c[S],G=R.instance,at=R.currentTarget,R=R.listener,G!==m&&f.isPropagationStopped())break t;m=R,f.currentTarget=at;try{m(f)}catch(xt){Ec(xt)}f.currentTarget=null,m=G}}}}function De(n,i){var r=i[Vs];r===void 0&&(r=i[Vs]=new Set);var c=n+"__bubble";r.has(c)||(c_(i,n,2,!1),r.add(c))}function ld(n,i,r){var c=0;i&&(c|=4),c_(r,n,c,i)}var uu="_reactListening"+Math.random().toString(36).slice(2);function cd(n){if(!n[uu]){n[uu]=!0,vc.forEach(function(r){r!=="selectionchange"&&(eb.has(r)||ld(r,!1,n),ld(r,!0,n))});var i=n.nodeType===9?n:n.ownerDocument;i===null||i[uu]||(i[uu]=!0,ld("selectionchange",!1,i))}}function c_(n,i,r,c){switch(z_(i)){case 2:var f=Cb;break;case 8:f=Db;break;default:f=Ed}r=f.bind(null,i,r,n),f=void 0,!Cf||i!=="touchstart"&&i!=="touchmove"&&i!=="wheel"||(f=!0),c?f!==void 0?n.addEventListener(i,r,{capture:!0,passive:f}):n.addEventListener(i,r,!0):f!==void 0?n.addEventListener(i,r,{passive:f}):n.addEventListener(i,r,!1)}function ud(n,i,r,c,f){var m=c;if((i&1)===0&&(i&2)===0&&c!==null)t:for(;;){if(c===null)return;var S=c.tag;if(S===3||S===4){var R=c.stateNode.containerInfo;if(R===f)break;if(S===4)for(S=c.return;S!==null;){var G=S.tag;if((G===3||G===4)&&S.stateNode.containerInfo===f)return;S=S.return}for(;R!==null;){if(S=_a(R),S===null)return;if(G=S.tag,G===5||G===6||G===26||G===27){c=m=S;continue t}R=R.parentNode}}c=c.return}pg(function(){var at=m,xt=wf(r),bt=[];t:{var ct=Vg.get(n);if(ct!==void 0){var ht=Sc,te=n;switch(n){case"keypress":if(xc(r)===0)break t;case"keydown":case"keyup":ht=ZS;break;case"focusin":te="focus",ht=Nf;break;case"focusout":te="blur",ht=Nf;break;case"beforeblur":case"afterblur":ht=Nf;break;case"click":if(r.button===2)break t;case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":ht=vg;break;case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":ht=BS;break;case"touchcancel":case"touchend":case"touchmove":case"touchstart":ht=QS;break;case zg:case Fg:case Hg:ht=FS;break;case Gg:ht=jS;break;case"scroll":case"scrollend":ht=OS;break;case"wheel":ht=eM;break;case"copy":case"cut":case"paste":ht=GS;break;case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":ht=xg;break;case"toggle":case"beforetoggle":ht=iM}var de=(i&4)!==0,je=!de&&(n==="scroll"||n==="scrollend"),j=de?ct!==null?ct+"Capture":null:ct;de=[];for(var Y=at,it;Y!==null;){var St=Y;if(it=St.stateNode,St=St.tag,St!==5&&St!==26&&St!==27||it===null||j===null||(St=Ko(Y,j),St!=null&&de.push(Rl(Y,St,it))),je)break;Y=Y.return}0<de.length&&(ct=new ht(ct,te,null,r,xt),bt.push({event:ct,listeners:de}))}}if((i&7)===0){t:{if(ct=n==="mouseover"||n==="pointerover",ht=n==="mouseout"||n==="pointerout",ct&&r!==Af&&(te=r.relatedTarget||r.fromElement)&&(_a(te)||te[ci]))break t;if((ht||ct)&&(ct=xt.window===xt?xt:(ct=xt.ownerDocument)?ct.defaultView||ct.parentWindow:window,ht?(te=r.relatedTarget||r.toElement,ht=at,te=te?_a(te):null,te!==null&&(je=l(te),de=te.tag,te!==je||de!==5&&de!==27&&de!==6)&&(te=null)):(ht=null,te=at),ht!==te)){if(de=vg,St="onMouseLeave",j="onMouseEnter",Y="mouse",(n==="pointerout"||n==="pointerover")&&(de=xg,St="onPointerLeave",j="onPointerEnter",Y="pointer"),je=ht==null?ct:Xs(ht),it=te==null?ct:Xs(te),ct=new de(St,Y+"leave",ht,r,xt),ct.target=je,ct.relatedTarget=it,St=null,_a(xt)===at&&(de=new de(j,Y+"enter",te,r,xt),de.target=it,de.relatedTarget=je,St=de),je=St,ht&&te)e:{for(de=nb,j=ht,Y=te,it=0,St=j;St;St=de(St))it++;St=0;for(var fe=Y;fe;fe=de(fe))St++;for(;0<it-St;)j=de(j),it--;for(;0<St-it;)Y=de(Y),St--;for(;it--;){if(j===Y||Y!==null&&j===Y.alternate){de=j;break e}j=de(j),Y=de(Y)}de=null}else de=null;ht!==null&&u_(bt,ct,ht,de,!1),te!==null&&je!==null&&u_(bt,je,te,de,!0)}}t:{if(ct=at?Xs(at):window,ht=ct.nodeName&&ct.nodeName.toLowerCase(),ht==="select"||ht==="input"&&ct.type==="file")var Fe=wg;else if(Tg(ct))if(Rg)Fe=dM;else{Fe=fM;var ie=uM}else ht=ct.nodeName,!ht||ht.toLowerCase()!=="input"||ct.type!=="checkbox"&&ct.type!=="radio"?at&&ke(at.elementType)&&(Fe=wg):Fe=hM;if(Fe&&(Fe=Fe(n,at))){Ag(bt,Fe,r,xt);break t}ie&&ie(n,ct,at),n==="focusout"&&at&&ct.type==="number"&&at.memoizedProps.value!=null&&Re(ct,"number",ct.value)}switch(ie=at?Xs(at):window,n){case"focusin":(Tg(ie)||ie.contentEditable==="true")&&(Ur=ie,Ff=at,il=null);break;case"focusout":il=Ff=Ur=null;break;case"mousedown":Hf=!0;break;case"contextmenu":case"mouseup":case"dragend":Hf=!1,Bg(bt,r,xt);break;case"selectionchange":if(mM)break;case"keydown":case"keyup":Bg(bt,r,xt)}var Te;if(Pf)t:{switch(n){case"compositionstart":var Ne="onCompositionStart";break t;case"compositionend":Ne="onCompositionEnd";break t;case"compositionupdate":Ne="onCompositionUpdate";break t}Ne=void 0}else Dr?bg(n,r)&&(Ne="onCompositionEnd"):n==="keydown"&&r.keyCode===229&&(Ne="onCompositionStart");Ne&&(yg&&r.locale!=="ko"&&(Dr||Ne!=="onCompositionStart"?Ne==="onCompositionEnd"&&Dr&&(Te=mg()):(ss=xt,Df="value"in ss?ss.value:ss.textContent,Dr=!0)),ie=fu(at,Ne),0<ie.length&&(Ne=new _g(Ne,n,null,r,xt),bt.push({event:Ne,listeners:ie}),Te?Ne.data=Te:(Te=Eg(r),Te!==null&&(Ne.data=Te)))),(Te=sM?rM(n,r):oM(n,r))&&(Ne=fu(at,"onBeforeInput"),0<Ne.length&&(ie=new _g("onBeforeInput","beforeinput",null,r,xt),bt.push({event:ie,listeners:Ne}),ie.data=Te)),$M(bt,n,at,r,xt)}l_(bt,i)})}function Rl(n,i,r){return{instance:n,listener:i,currentTarget:r}}function fu(n,i){for(var r=i+"Capture",c=[];n!==null;){var f=n,m=f.stateNode;if(f=f.tag,f!==5&&f!==26&&f!==27||m===null||(f=Ko(n,r),f!=null&&c.unshift(Rl(n,f,m)),f=Ko(n,i),f!=null&&c.push(Rl(n,f,m))),n.tag===3)return c;n=n.return}return[]}function nb(n){if(n===null)return null;do n=n.return;while(n&&n.tag!==5&&n.tag!==27);return n||null}function u_(n,i,r,c,f){for(var m=i._reactName,S=[];r!==null&&r!==c;){var R=r,G=R.alternate,at=R.stateNode;if(R=R.tag,G!==null&&G===c)break;R!==5&&R!==26&&R!==27||at===null||(G=at,f?(at=Ko(r,m),at!=null&&S.unshift(Rl(r,at,G))):f||(at=Ko(r,m),at!=null&&S.push(Rl(r,at,G)))),r=r.return}S.length!==0&&n.push({event:i,listeners:S})}var ib=/\r\n?/g,ab=/\u0000|\uFFFD/g;function f_(n){return(typeof n=="string"?n:""+n).replace(ib,`
`).replace(ab,"")}function h_(n,i){return i=f_(i),f_(n)===i}function $e(n,i,r,c,f,m){switch(r){case"children":typeof c=="string"?i==="body"||i==="textarea"&&c===""||xi(n,c):(typeof c=="number"||typeof c=="bigint")&&i!=="body"&&xi(n,""+c);break;case"className":jt(n,"class",c);break;case"tabIndex":jt(n,"tabindex",c);break;case"dir":case"role":case"viewBox":case"width":case"height":jt(n,r,c);break;case"style":Wi(n,c,m);break;case"data":if(i!=="object"){jt(n,"data",c);break}case"src":case"href":if(c===""&&(i!=="a"||r!=="href")){n.removeAttribute(r);break}if(c==null||typeof c=="function"||typeof c=="symbol"||typeof c=="boolean"){n.removeAttribute(r);break}c=Ws(""+c),n.setAttribute(r,c);break;case"action":case"formAction":if(typeof c=="function"){n.setAttribute(r,"javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");break}else typeof m=="function"&&(r==="formAction"?(i!=="input"&&$e(n,i,"name",f.name,f,null),$e(n,i,"formEncType",f.formEncType,f,null),$e(n,i,"formMethod",f.formMethod,f,null),$e(n,i,"formTarget",f.formTarget,f,null)):($e(n,i,"encType",f.encType,f,null),$e(n,i,"method",f.method,f,null),$e(n,i,"target",f.target,f,null)));if(c==null||typeof c=="symbol"||typeof c=="boolean"){n.removeAttribute(r);break}c=Ws(""+c),n.setAttribute(r,c);break;case"onClick":c!=null&&(n.onclick=ya);break;case"onScroll":c!=null&&De("scroll",n);break;case"onScrollEnd":c!=null&&De("scrollend",n);break;case"dangerouslySetInnerHTML":if(c!=null){if(typeof c!="object"||!("__html"in c))throw Error(a(61));if(r=c.__html,r!=null){if(f.children!=null)throw Error(a(60));n.innerHTML=r}}break;case"multiple":n.multiple=c&&typeof c!="function"&&typeof c!="symbol";break;case"muted":n.muted=c&&typeof c!="function"&&typeof c!="symbol";break;case"suppressContentEditableWarning":case"suppressHydrationWarning":case"defaultValue":case"defaultChecked":case"innerHTML":case"ref":break;case"autoFocus":break;case"xlinkHref":if(c==null||typeof c=="function"||typeof c=="boolean"||typeof c=="symbol"){n.removeAttribute("xlink:href");break}r=Ws(""+c),n.setAttributeNS("http://www.w3.org/1999/xlink","xlink:href",r);break;case"contentEditable":case"spellCheck":case"draggable":case"value":case"autoReverse":case"externalResourcesRequired":case"focusable":case"preserveAlpha":c!=null&&typeof c!="function"&&typeof c!="symbol"?n.setAttribute(r,""+c):n.removeAttribute(r);break;case"inert":case"allowFullScreen":case"async":case"autoPlay":case"controls":case"default":case"defer":case"disabled":case"disablePictureInPicture":case"disableRemotePlayback":case"formNoValidate":case"hidden":case"loop":case"noModule":case"noValidate":case"open":case"playsInline":case"readOnly":case"required":case"reversed":case"scoped":case"seamless":case"itemScope":c&&typeof c!="function"&&typeof c!="symbol"?n.setAttribute(r,""):n.removeAttribute(r);break;case"capture":case"download":c===!0?n.setAttribute(r,""):c!==!1&&c!=null&&typeof c!="function"&&typeof c!="symbol"?n.setAttribute(r,c):n.removeAttribute(r);break;case"cols":case"rows":case"size":case"span":c!=null&&typeof c!="function"&&typeof c!="symbol"&&!isNaN(c)&&1<=c?n.setAttribute(r,c):n.removeAttribute(r);break;case"rowSpan":case"start":c==null||typeof c=="function"||typeof c=="symbol"||isNaN(c)?n.removeAttribute(r):n.setAttribute(r,c);break;case"popover":De("beforetoggle",n),De("toggle",n),Ht(n,"popover",c);break;case"xlinkActuate":$t(n,"http://www.w3.org/1999/xlink","xlink:actuate",c);break;case"xlinkArcrole":$t(n,"http://www.w3.org/1999/xlink","xlink:arcrole",c);break;case"xlinkRole":$t(n,"http://www.w3.org/1999/xlink","xlink:role",c);break;case"xlinkShow":$t(n,"http://www.w3.org/1999/xlink","xlink:show",c);break;case"xlinkTitle":$t(n,"http://www.w3.org/1999/xlink","xlink:title",c);break;case"xlinkType":$t(n,"http://www.w3.org/1999/xlink","xlink:type",c);break;case"xmlBase":$t(n,"http://www.w3.org/XML/1998/namespace","xml:base",c);break;case"xmlLang":$t(n,"http://www.w3.org/XML/1998/namespace","xml:lang",c);break;case"xmlSpace":$t(n,"http://www.w3.org/XML/1998/namespace","xml:space",c);break;case"is":Ht(n,"is",c);break;case"innerText":case"textContent":break;default:(!(2<r.length)||r[0]!=="o"&&r[0]!=="O"||r[1]!=="n"&&r[1]!=="N")&&(r=ia.get(r)||r,Ht(n,r,c))}}function fd(n,i,r,c,f,m){switch(r){case"style":Wi(n,c,m);break;case"dangerouslySetInnerHTML":if(c!=null){if(typeof c!="object"||!("__html"in c))throw Error(a(61));if(r=c.__html,r!=null){if(f.children!=null)throw Error(a(60));n.innerHTML=r}}break;case"children":typeof c=="string"?xi(n,c):(typeof c=="number"||typeof c=="bigint")&&xi(n,""+c);break;case"onScroll":c!=null&&De("scroll",n);break;case"onScrollEnd":c!=null&&De("scrollend",n);break;case"onClick":c!=null&&(n.onclick=ya);break;case"suppressContentEditableWarning":case"suppressHydrationWarning":case"innerHTML":case"ref":break;case"innerText":case"textContent":break;default:if(!w.hasOwnProperty(r))t:{if(r[0]==="o"&&r[1]==="n"&&(f=r.endsWith("Capture"),i=r.slice(2,f?r.length-7:void 0),m=n[zn]||null,m=m!=null?m[r]:null,typeof m=="function"&&n.removeEventListener(i,m,f),typeof c=="function")){typeof m!="function"&&m!==null&&(r in n?n[r]=null:n.hasAttribute(r)&&n.removeAttribute(r)),n.addEventListener(i,c,f);break t}r in n?n[r]=c:c===!0?n.setAttribute(r,""):Ht(n,r,c)}}}function Vn(n,i,r){switch(i){case"div":case"span":case"svg":case"path":case"a":case"g":case"p":case"li":break;case"img":De("error",n),De("load",n);var c=!1,f=!1,m;for(m in r)if(r.hasOwnProperty(m)){var S=r[m];if(S!=null)switch(m){case"src":c=!0;break;case"srcSet":f=!0;break;case"children":case"dangerouslySetInnerHTML":throw Error(a(137,i));default:$e(n,i,m,S,r,null)}}f&&$e(n,i,"srcSet",r.srcSet,r,null),c&&$e(n,i,"src",r.src,r,null);return;case"input":De("invalid",n);var R=m=S=f=null,G=null,at=null;for(c in r)if(r.hasOwnProperty(c)){var xt=r[c];if(xt!=null)switch(c){case"name":f=xt;break;case"type":S=xt;break;case"checked":G=xt;break;case"defaultChecked":at=xt;break;case"value":m=xt;break;case"defaultValue":R=xt;break;case"children":case"dangerouslySetInnerHTML":if(xt!=null)throw Error(a(137,i));break;default:$e(n,i,c,xt,r,null)}}Zn(n,m,R,G,at,S,f,!1);return;case"select":De("invalid",n),c=S=m=null;for(f in r)if(r.hasOwnProperty(f)&&(R=r[f],R!=null))switch(f){case"value":m=R;break;case"defaultValue":S=R;break;case"multiple":c=R;default:$e(n,i,f,R,r,null)}i=m,r=S,n.multiple=!!c,i!=null?Dn(n,!!c,i,!1):r!=null&&Dn(n,!!c,r,!0);return;case"textarea":De("invalid",n),m=f=c=null;for(S in r)if(r.hasOwnProperty(S)&&(R=r[S],R!=null))switch(S){case"value":c=R;break;case"defaultValue":f=R;break;case"children":m=R;break;case"dangerouslySetInnerHTML":if(R!=null)throw Error(a(91));break;default:$e(n,i,S,R,r,null)}Xi(n,c,f,m);return;case"option":for(G in r)r.hasOwnProperty(G)&&(c=r[G],c!=null)&&(G==="selected"?n.selected=c&&typeof c!="function"&&typeof c!="symbol":$e(n,i,G,c,r,null));return;case"dialog":De("beforetoggle",n),De("toggle",n),De("cancel",n),De("close",n);break;case"iframe":case"object":De("load",n);break;case"video":case"audio":for(c=0;c<wl.length;c++)De(wl[c],n);break;case"image":De("error",n),De("load",n);break;case"details":De("toggle",n);break;case"embed":case"source":case"link":De("error",n),De("load",n);case"area":case"base":case"br":case"col":case"hr":case"keygen":case"meta":case"param":case"track":case"wbr":case"menuitem":for(at in r)if(r.hasOwnProperty(at)&&(c=r[at],c!=null))switch(at){case"children":case"dangerouslySetInnerHTML":throw Error(a(137,i));default:$e(n,i,at,c,r,null)}return;default:if(ke(i)){for(xt in r)r.hasOwnProperty(xt)&&(c=r[xt],c!==void 0&&fd(n,i,xt,c,r,void 0));return}}for(R in r)r.hasOwnProperty(R)&&(c=r[R],c!=null&&$e(n,i,R,c,r,null))}function sb(n,i,r,c){switch(i){case"div":case"span":case"svg":case"path":case"a":case"g":case"p":case"li":break;case"input":var f=null,m=null,S=null,R=null,G=null,at=null,xt=null;for(ht in r){var bt=r[ht];if(r.hasOwnProperty(ht)&&bt!=null)switch(ht){case"checked":break;case"value":break;case"defaultValue":G=bt;default:c.hasOwnProperty(ht)||$e(n,i,ht,null,c,bt)}}for(var ct in c){var ht=c[ct];if(bt=r[ct],c.hasOwnProperty(ct)&&(ht!=null||bt!=null))switch(ct){case"type":m=ht;break;case"name":f=ht;break;case"checked":at=ht;break;case"defaultChecked":xt=ht;break;case"value":S=ht;break;case"defaultValue":R=ht;break;case"children":case"dangerouslySetInnerHTML":if(ht!=null)throw Error(a(137,i));break;default:ht!==bt&&$e(n,i,ct,ht,c,bt)}}Zt(n,S,R,G,at,xt,m,f);return;case"select":ht=S=R=ct=null;for(m in r)if(G=r[m],r.hasOwnProperty(m)&&G!=null)switch(m){case"value":break;case"multiple":ht=G;default:c.hasOwnProperty(m)||$e(n,i,m,null,c,G)}for(f in c)if(m=c[f],G=r[f],c.hasOwnProperty(f)&&(m!=null||G!=null))switch(f){case"value":ct=m;break;case"defaultValue":R=m;break;case"multiple":S=m;default:m!==G&&$e(n,i,f,m,c,G)}i=R,r=S,c=ht,ct!=null?Dn(n,!!r,ct,!1):!!c!=!!r&&(i!=null?Dn(n,!!r,i,!0):Dn(n,!!r,r?[]:"",!1));return;case"textarea":ht=ct=null;for(R in r)if(f=r[R],r.hasOwnProperty(R)&&f!=null&&!c.hasOwnProperty(R))switch(R){case"value":break;case"children":break;default:$e(n,i,R,null,c,f)}for(S in c)if(f=c[S],m=r[S],c.hasOwnProperty(S)&&(f!=null||m!=null))switch(S){case"value":ct=f;break;case"defaultValue":ht=f;break;case"children":break;case"dangerouslySetInnerHTML":if(f!=null)throw Error(a(91));break;default:f!==m&&$e(n,i,S,f,c,m)}_i(n,ct,ht);return;case"option":for(var te in r)ct=r[te],r.hasOwnProperty(te)&&ct!=null&&!c.hasOwnProperty(te)&&(te==="selected"?n.selected=!1:$e(n,i,te,null,c,ct));for(G in c)ct=c[G],ht=r[G],c.hasOwnProperty(G)&&ct!==ht&&(ct!=null||ht!=null)&&(G==="selected"?n.selected=ct&&typeof ct!="function"&&typeof ct!="symbol":$e(n,i,G,ct,c,ht));return;case"img":case"link":case"area":case"base":case"br":case"col":case"embed":case"hr":case"keygen":case"meta":case"param":case"source":case"track":case"wbr":case"menuitem":for(var de in r)ct=r[de],r.hasOwnProperty(de)&&ct!=null&&!c.hasOwnProperty(de)&&$e(n,i,de,null,c,ct);for(at in c)if(ct=c[at],ht=r[at],c.hasOwnProperty(at)&&ct!==ht&&(ct!=null||ht!=null))switch(at){case"children":case"dangerouslySetInnerHTML":if(ct!=null)throw Error(a(137,i));break;default:$e(n,i,at,ct,c,ht)}return;default:if(ke(i)){for(var je in r)ct=r[je],r.hasOwnProperty(je)&&ct!==void 0&&!c.hasOwnProperty(je)&&fd(n,i,je,void 0,c,ct);for(xt in c)ct=c[xt],ht=r[xt],!c.hasOwnProperty(xt)||ct===ht||ct===void 0&&ht===void 0||fd(n,i,xt,ct,c,ht);return}}for(var j in r)ct=r[j],r.hasOwnProperty(j)&&ct!=null&&!c.hasOwnProperty(j)&&$e(n,i,j,null,c,ct);for(bt in c)ct=c[bt],ht=r[bt],!c.hasOwnProperty(bt)||ct===ht||ct==null&&ht==null||$e(n,i,bt,ct,c,ht)}function d_(n){switch(n){case"css":case"script":case"font":case"img":case"image":case"input":case"link":return!0;default:return!1}}function rb(){if(typeof performance.getEntriesByType=="function"){for(var n=0,i=0,r=performance.getEntriesByType("resource"),c=0;c<r.length;c++){var f=r[c],m=f.transferSize,S=f.initiatorType,R=f.duration;if(m&&R&&d_(S)){for(S=0,R=f.responseEnd,c+=1;c<r.length;c++){var G=r[c],at=G.startTime;if(at>R)break;var xt=G.transferSize,bt=G.initiatorType;xt&&d_(bt)&&(G=G.responseEnd,S+=xt*(G<R?1:(R-at)/(G-at)))}if(--c,i+=8*(m+S)/(f.duration/1e3),n++,10<n)break}}if(0<n)return i/n/1e6}return navigator.connection&&(n=navigator.connection.downlink,typeof n=="number")?n:5}var hd=null,dd=null;function hu(n){return n.nodeType===9?n:n.ownerDocument}function p_(n){switch(n){case"http://www.w3.org/2000/svg":return 1;case"http://www.w3.org/1998/Math/MathML":return 2;default:return 0}}function m_(n,i){if(n===0)switch(i){case"svg":return 1;case"math":return 2;default:return 0}return n===1&&i==="foreignObject"?0:n}function pd(n,i){return n==="textarea"||n==="noscript"||typeof i.children=="string"||typeof i.children=="number"||typeof i.children=="bigint"||typeof i.dangerouslySetInnerHTML=="object"&&i.dangerouslySetInnerHTML!==null&&i.dangerouslySetInnerHTML.__html!=null}var md=null;function ob(){var n=window.event;return n&&n.type==="popstate"?n===md?!1:(md=n,!0):(md=null,!1)}var g_=typeof setTimeout=="function"?setTimeout:void 0,lb=typeof clearTimeout=="function"?clearTimeout:void 0,v_=typeof Promise=="function"?Promise:void 0,cb=typeof queueMicrotask=="function"?queueMicrotask:typeof v_<"u"?function(n){return v_.resolve(null).then(n).catch(ub)}:g_;function ub(n){setTimeout(function(){throw n})}function Ms(n){return n==="head"}function __(n,i){var r=i,c=0;do{var f=r.nextSibling;if(n.removeChild(r),f&&f.nodeType===8)if(r=f.data,r==="/$"||r==="/&"){if(c===0){n.removeChild(f),ao(i);return}c--}else if(r==="$"||r==="$?"||r==="$~"||r==="$!"||r==="&")c++;else if(r==="html")Cl(n.ownerDocument.documentElement);else if(r==="head"){r=n.ownerDocument.head,Cl(r);for(var m=r.firstChild;m;){var S=m.nextSibling,R=m.nodeName;m[es]||R==="SCRIPT"||R==="STYLE"||R==="LINK"&&m.rel.toLowerCase()==="stylesheet"||r.removeChild(m),m=S}}else r==="body"&&Cl(n.ownerDocument.body);r=f}while(r);ao(i)}function x_(n,i){var r=n;n=0;do{var c=r.nextSibling;if(r.nodeType===1?i?(r._stashedDisplay=r.style.display,r.style.display="none"):(r.style.display=r._stashedDisplay||"",r.getAttribute("style")===""&&r.removeAttribute("style")):r.nodeType===3&&(i?(r._stashedText=r.nodeValue,r.nodeValue=""):r.nodeValue=r._stashedText||""),c&&c.nodeType===8)if(r=c.data,r==="/$"){if(n===0)break;n--}else r!=="$"&&r!=="$?"&&r!=="$~"&&r!=="$!"||n++;r=c}while(r)}function gd(n){var i=n.firstChild;for(i&&i.nodeType===10&&(i=i.nextSibling);i;){var r=i;switch(i=i.nextSibling,r.nodeName){case"HTML":case"HEAD":case"BODY":gd(r),ns(r);continue;case"SCRIPT":case"STYLE":continue;case"LINK":if(r.rel.toLowerCase()==="stylesheet")continue}n.removeChild(r)}}function fb(n,i,r,c){for(;n.nodeType===1;){var f=r;if(n.nodeName.toLowerCase()!==i.toLowerCase()){if(!c&&(n.nodeName!=="INPUT"||n.type!=="hidden"))break}else if(c){if(!n[es])switch(i){case"meta":if(!n.hasAttribute("itemprop"))break;return n;case"link":if(m=n.getAttribute("rel"),m==="stylesheet"&&n.hasAttribute("data-precedence"))break;if(m!==f.rel||n.getAttribute("href")!==(f.href==null||f.href===""?null:f.href)||n.getAttribute("crossorigin")!==(f.crossOrigin==null?null:f.crossOrigin)||n.getAttribute("title")!==(f.title==null?null:f.title))break;return n;case"style":if(n.hasAttribute("data-precedence"))break;return n;case"script":if(m=n.getAttribute("src"),(m!==(f.src==null?null:f.src)||n.getAttribute("type")!==(f.type==null?null:f.type)||n.getAttribute("crossorigin")!==(f.crossOrigin==null?null:f.crossOrigin))&&m&&n.hasAttribute("async")&&!n.hasAttribute("itemprop"))break;return n;default:return n}}else if(i==="input"&&n.type==="hidden"){var m=f.name==null?null:""+f.name;if(f.type==="hidden"&&n.getAttribute("name")===m)return n}else return n;if(n=zi(n.nextSibling),n===null)break}return null}function hb(n,i,r){if(i==="")return null;for(;n.nodeType!==3;)if((n.nodeType!==1||n.nodeName!=="INPUT"||n.type!=="hidden")&&!r||(n=zi(n.nextSibling),n===null))return null;return n}function y_(n,i){for(;n.nodeType!==8;)if((n.nodeType!==1||n.nodeName!=="INPUT"||n.type!=="hidden")&&!i||(n=zi(n.nextSibling),n===null))return null;return n}function vd(n){return n.data==="$?"||n.data==="$~"}function _d(n){return n.data==="$!"||n.data==="$?"&&n.ownerDocument.readyState!=="loading"}function db(n,i){var r=n.ownerDocument;if(n.data==="$~")n._reactRetry=i;else if(n.data!=="$?"||r.readyState!=="loading")i();else{var c=function(){i(),r.removeEventListener("DOMContentLoaded",c)};r.addEventListener("DOMContentLoaded",c),n._reactRetry=c}}function zi(n){for(;n!=null;n=n.nextSibling){var i=n.nodeType;if(i===1||i===3)break;if(i===8){if(i=n.data,i==="$"||i==="$!"||i==="$?"||i==="$~"||i==="&"||i==="F!"||i==="F")break;if(i==="/$"||i==="/&")return null}}return n}var xd=null;function S_(n){n=n.nextSibling;for(var i=0;n;){if(n.nodeType===8){var r=n.data;if(r==="/$"||r==="/&"){if(i===0)return zi(n.nextSibling);i--}else r!=="$"&&r!=="$!"&&r!=="$?"&&r!=="$~"&&r!=="&"||i++}n=n.nextSibling}return null}function M_(n){n=n.previousSibling;for(var i=0;n;){if(n.nodeType===8){var r=n.data;if(r==="$"||r==="$!"||r==="$?"||r==="$~"||r==="&"){if(i===0)return n;i--}else r!=="/$"&&r!=="/&"||i++}n=n.previousSibling}return null}function b_(n,i,r){switch(i=hu(r),n){case"html":if(n=i.documentElement,!n)throw Error(a(452));return n;case"head":if(n=i.head,!n)throw Error(a(453));return n;case"body":if(n=i.body,!n)throw Error(a(454));return n;default:throw Error(a(451))}}function Cl(n){for(var i=n.attributes;i.length;)n.removeAttributeNode(i[0]);ns(n)}var Fi=new Map,E_=new Set;function du(n){return typeof n.getRootNode=="function"?n.getRootNode():n.nodeType===9?n:n.ownerDocument}var Ba=N.d;N.d={f:pb,r:mb,D:gb,C:vb,L:_b,m:xb,X:Sb,S:yb,M:Mb};function pb(){var n=Ba.f(),i=au();return n||i}function mb(n){var i=xa(n);i!==null&&i.tag===5&&i.type==="form"?G0(i):Ba.r(n)}var eo=typeof document>"u"?null:document;function T_(n,i,r){var c=eo;if(c&&typeof i=="string"&&i){var f=qe(i);f='link[rel="'+n+'"][href="'+f+'"]',typeof r=="string"&&(f+='[crossorigin="'+r+'"]'),E_.has(f)||(E_.add(f),n={rel:n,crossOrigin:r,href:i},c.querySelector(f)===null&&(i=c.createElement("link"),Vn(i,"link",n),bn(i),c.head.appendChild(i)))}}function gb(n){Ba.D(n),T_("dns-prefetch",n,null)}function vb(n,i){Ba.C(n,i),T_("preconnect",n,i)}function _b(n,i,r){Ba.L(n,i,r);var c=eo;if(c&&n&&i){var f='link[rel="preload"][as="'+qe(i)+'"]';i==="image"&&r&&r.imageSrcSet?(f+='[imagesrcset="'+qe(r.imageSrcSet)+'"]',typeof r.imageSizes=="string"&&(f+='[imagesizes="'+qe(r.imageSizes)+'"]')):f+='[href="'+qe(n)+'"]';var m=f;switch(i){case"style":m=no(n);break;case"script":m=io(n)}Fi.has(m)||(n=_({rel:"preload",href:i==="image"&&r&&r.imageSrcSet?void 0:n,as:i},r),Fi.set(m,n),c.querySelector(f)!==null||i==="style"&&c.querySelector(Dl(m))||i==="script"&&c.querySelector(Ul(m))||(i=c.createElement("link"),Vn(i,"link",n),bn(i),c.head.appendChild(i)))}}function xb(n,i){Ba.m(n,i);var r=eo;if(r&&n){var c=i&&typeof i.as=="string"?i.as:"script",f='link[rel="modulepreload"][as="'+qe(c)+'"][href="'+qe(n)+'"]',m=f;switch(c){case"audioworklet":case"paintworklet":case"serviceworker":case"sharedworker":case"worker":case"script":m=io(n)}if(!Fi.has(m)&&(n=_({rel:"modulepreload",href:n},i),Fi.set(m,n),r.querySelector(f)===null)){switch(c){case"audioworklet":case"paintworklet":case"serviceworker":case"sharedworker":case"worker":case"script":if(r.querySelector(Ul(m)))return}c=r.createElement("link"),Vn(c,"link",n),bn(c),r.head.appendChild(c)}}}function yb(n,i,r){Ba.S(n,i,r);var c=eo;if(c&&n){var f=is(c).hoistableStyles,m=no(n);i=i||"default";var S=f.get(m);if(!S){var R={loading:0,preload:null};if(S=c.querySelector(Dl(m)))R.loading=5;else{n=_({rel:"stylesheet",href:n,"data-precedence":i},r),(r=Fi.get(m))&&yd(n,r);var G=S=c.createElement("link");bn(G),Vn(G,"link",n),G._p=new Promise(function(at,xt){G.onload=at,G.onerror=xt}),G.addEventListener("load",function(){R.loading|=1}),G.addEventListener("error",function(){R.loading|=2}),R.loading|=4,pu(S,i,c)}S={type:"stylesheet",instance:S,count:1,state:R},f.set(m,S)}}}function Sb(n,i){Ba.X(n,i);var r=eo;if(r&&n){var c=is(r).hoistableScripts,f=io(n),m=c.get(f);m||(m=r.querySelector(Ul(f)),m||(n=_({src:n,async:!0},i),(i=Fi.get(f))&&Sd(n,i),m=r.createElement("script"),bn(m),Vn(m,"link",n),r.head.appendChild(m)),m={type:"script",instance:m,count:1,state:null},c.set(f,m))}}function Mb(n,i){Ba.M(n,i);var r=eo;if(r&&n){var c=is(r).hoistableScripts,f=io(n),m=c.get(f);m||(m=r.querySelector(Ul(f)),m||(n=_({src:n,async:!0,type:"module"},i),(i=Fi.get(f))&&Sd(n,i),m=r.createElement("script"),bn(m),Vn(m,"link",n),r.head.appendChild(m)),m={type:"script",instance:m,count:1,state:null},c.set(f,m))}}function A_(n,i,r,c){var f=(f=et.current)?du(f):null;if(!f)throw Error(a(446));switch(n){case"meta":case"title":return null;case"style":return typeof r.precedence=="string"&&typeof r.href=="string"?(i=no(r.href),r=is(f).hoistableStyles,c=r.get(i),c||(c={type:"style",instance:null,count:0,state:null},r.set(i,c)),c):{type:"void",instance:null,count:0,state:null};case"link":if(r.rel==="stylesheet"&&typeof r.href=="string"&&typeof r.precedence=="string"){n=no(r.href);var m=is(f).hoistableStyles,S=m.get(n);if(S||(f=f.ownerDocument||f,S={type:"stylesheet",instance:null,count:0,state:{loading:0,preload:null}},m.set(n,S),(m=f.querySelector(Dl(n)))&&!m._p&&(S.instance=m,S.state.loading=5),Fi.has(n)||(r={rel:"preload",as:"style",href:r.href,crossOrigin:r.crossOrigin,integrity:r.integrity,media:r.media,hrefLang:r.hrefLang,referrerPolicy:r.referrerPolicy},Fi.set(n,r),m||bb(f,n,r,S.state))),i&&c===null)throw Error(a(528,""));return S}if(i&&c!==null)throw Error(a(529,""));return null;case"script":return i=r.async,r=r.src,typeof r=="string"&&i&&typeof i!="function"&&typeof i!="symbol"?(i=io(r),r=is(f).hoistableScripts,c=r.get(i),c||(c={type:"script",instance:null,count:0,state:null},r.set(i,c)),c):{type:"void",instance:null,count:0,state:null};default:throw Error(a(444,n))}}function no(n){return'href="'+qe(n)+'"'}function Dl(n){return'link[rel="stylesheet"]['+n+"]"}function w_(n){return _({},n,{"data-precedence":n.precedence,precedence:null})}function bb(n,i,r,c){n.querySelector('link[rel="preload"][as="style"]['+i+"]")?c.loading=1:(i=n.createElement("link"),c.preload=i,i.addEventListener("load",function(){return c.loading|=1}),i.addEventListener("error",function(){return c.loading|=2}),Vn(i,"link",r),bn(i),n.head.appendChild(i))}function io(n){return'[src="'+qe(n)+'"]'}function Ul(n){return"script[async]"+n}function R_(n,i,r){if(i.count++,i.instance===null)switch(i.type){case"style":var c=n.querySelector('style[data-href~="'+qe(r.href)+'"]');if(c)return i.instance=c,bn(c),c;var f=_({},r,{"data-href":r.href,"data-precedence":r.precedence,href:null,precedence:null});return c=(n.ownerDocument||n).createElement("style"),bn(c),Vn(c,"style",f),pu(c,r.precedence,n),i.instance=c;case"stylesheet":f=no(r.href);var m=n.querySelector(Dl(f));if(m)return i.state.loading|=4,i.instance=m,bn(m),m;c=w_(r),(f=Fi.get(f))&&yd(c,f),m=(n.ownerDocument||n).createElement("link"),bn(m);var S=m;return S._p=new Promise(function(R,G){S.onload=R,S.onerror=G}),Vn(m,"link",c),i.state.loading|=4,pu(m,r.precedence,n),i.instance=m;case"script":return m=io(r.src),(f=n.querySelector(Ul(m)))?(i.instance=f,bn(f),f):(c=r,(f=Fi.get(m))&&(c=_({},r),Sd(c,f)),n=n.ownerDocument||n,f=n.createElement("script"),bn(f),Vn(f,"link",c),n.head.appendChild(f),i.instance=f);case"void":return null;default:throw Error(a(443,i.type))}else i.type==="stylesheet"&&(i.state.loading&4)===0&&(c=i.instance,i.state.loading|=4,pu(c,r.precedence,n));return i.instance}function pu(n,i,r){for(var c=r.querySelectorAll('link[rel="stylesheet"][data-precedence],style[data-precedence]'),f=c.length?c[c.length-1]:null,m=f,S=0;S<c.length;S++){var R=c[S];if(R.dataset.precedence===i)m=R;else if(m!==f)break}m?m.parentNode.insertBefore(n,m.nextSibling):(i=r.nodeType===9?r.head:r,i.insertBefore(n,i.firstChild))}function yd(n,i){n.crossOrigin==null&&(n.crossOrigin=i.crossOrigin),n.referrerPolicy==null&&(n.referrerPolicy=i.referrerPolicy),n.title==null&&(n.title=i.title)}function Sd(n,i){n.crossOrigin==null&&(n.crossOrigin=i.crossOrigin),n.referrerPolicy==null&&(n.referrerPolicy=i.referrerPolicy),n.integrity==null&&(n.integrity=i.integrity)}var mu=null;function C_(n,i,r){if(mu===null){var c=new Map,f=mu=new Map;f.set(r,c)}else f=mu,c=f.get(r),c||(c=new Map,f.set(r,c));if(c.has(n))return c;for(c.set(n,null),r=r.getElementsByTagName(n),f=0;f<r.length;f++){var m=r[f];if(!(m[es]||m[Mn]||n==="link"&&m.getAttribute("rel")==="stylesheet")&&m.namespaceURI!=="http://www.w3.org/2000/svg"){var S=m.getAttribute(i)||"";S=n+S;var R=c.get(S);R?R.push(m):c.set(S,[m])}}return c}function D_(n,i,r){n=n.ownerDocument||n,n.head.insertBefore(r,i==="title"?n.querySelector("head > title"):null)}function Eb(n,i,r){if(r===1||i.itemProp!=null)return!1;switch(n){case"meta":case"title":return!0;case"style":if(typeof i.precedence!="string"||typeof i.href!="string"||i.href==="")break;return!0;case"link":if(typeof i.rel!="string"||typeof i.href!="string"||i.href===""||i.onLoad||i.onError)break;return i.rel==="stylesheet"?(n=i.disabled,typeof i.precedence=="string"&&n==null):!0;case"script":if(i.async&&typeof i.async!="function"&&typeof i.async!="symbol"&&!i.onLoad&&!i.onError&&i.src&&typeof i.src=="string")return!0}return!1}function U_(n){return!(n.type==="stylesheet"&&(n.state.loading&3)===0)}function Tb(n,i,r,c){if(r.type==="stylesheet"&&(typeof c.media!="string"||matchMedia(c.media).matches!==!1)&&(r.state.loading&4)===0){if(r.instance===null){var f=no(c.href),m=i.querySelector(Dl(f));if(m){i=m._p,i!==null&&typeof i=="object"&&typeof i.then=="function"&&(n.count++,n=gu.bind(n),i.then(n,n)),r.state.loading|=4,r.instance=m,bn(m);return}m=i.ownerDocument||i,c=w_(c),(f=Fi.get(f))&&yd(c,f),m=m.createElement("link"),bn(m);var S=m;S._p=new Promise(function(R,G){S.onload=R,S.onerror=G}),Vn(m,"link",c),r.instance=m}n.stylesheets===null&&(n.stylesheets=new Map),n.stylesheets.set(r,i),(i=r.state.preload)&&(r.state.loading&3)===0&&(n.count++,r=gu.bind(n),i.addEventListener("load",r),i.addEventListener("error",r))}}var Md=0;function Ab(n,i){return n.stylesheets&&n.count===0&&_u(n,n.stylesheets),0<n.count||0<n.imgCount?function(r){var c=setTimeout(function(){if(n.stylesheets&&_u(n,n.stylesheets),n.unsuspend){var m=n.unsuspend;n.unsuspend=null,m()}},6e4+i);0<n.imgBytes&&Md===0&&(Md=62500*rb());var f=setTimeout(function(){if(n.waitingForImages=!1,n.count===0&&(n.stylesheets&&_u(n,n.stylesheets),n.unsuspend)){var m=n.unsuspend;n.unsuspend=null,m()}},(n.imgBytes>Md?50:800)+i);return n.unsuspend=r,function(){n.unsuspend=null,clearTimeout(c),clearTimeout(f)}}:null}function gu(){if(this.count--,this.count===0&&(this.imgCount===0||!this.waitingForImages)){if(this.stylesheets)_u(this,this.stylesheets);else if(this.unsuspend){var n=this.unsuspend;this.unsuspend=null,n()}}}var vu=null;function _u(n,i){n.stylesheets=null,n.unsuspend!==null&&(n.count++,vu=new Map,i.forEach(wb,n),vu=null,gu.call(n))}function wb(n,i){if(!(i.state.loading&4)){var r=vu.get(n);if(r)var c=r.get(null);else{r=new Map,vu.set(n,r);for(var f=n.querySelectorAll("link[data-precedence],style[data-precedence]"),m=0;m<f.length;m++){var S=f[m];(S.nodeName==="LINK"||S.getAttribute("media")!=="not all")&&(r.set(S.dataset.precedence,S),c=S)}c&&r.set(null,c)}f=i.instance,S=f.getAttribute("data-precedence"),m=r.get(S)||c,m===c&&r.set(null,f),r.set(S,f),this.count++,c=gu.bind(this),f.addEventListener("load",c),f.addEventListener("error",c),m?m.parentNode.insertBefore(f,m.nextSibling):(n=n.nodeType===9?n.head:n,n.insertBefore(f,n.firstChild)),i.state.loading|=4}}var Ll={$$typeof:D,Provider:null,Consumer:null,_currentValue:V,_currentValue2:V,_threadCount:0};function Rb(n,i,r,c,f,m,S,R,G){this.tag=1,this.containerInfo=n,this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.next=this.pendingContext=this.context=this.cancelPendingCommit=null,this.callbackPriority=0,this.expirationTimes=ee(-1),this.entangledLanes=this.shellSuspendCounter=this.errorRecoveryDisabledLanes=this.expiredLanes=this.warmLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=ee(0),this.hiddenUpdates=ee(null),this.identifierPrefix=c,this.onUncaughtError=f,this.onCaughtError=m,this.onRecoverableError=S,this.pooledCache=null,this.pooledCacheLanes=0,this.formState=G,this.incompleteTransitions=new Map}function L_(n,i,r,c,f,m,S,R,G,at,xt,bt){return n=new Rb(n,i,r,S,G,at,xt,bt,R),i=1,m===!0&&(i|=24),m=Si(3,null,null,i),n.current=m,m.stateNode=n,i=eh(),i.refCount++,n.pooledCache=i,i.refCount++,m.memoizedState={element:c,isDehydrated:r,cache:i},sh(m),n}function N_(n){return n?(n=Or,n):Or}function O_(n,i,r,c,f,m){f=N_(f),c.context===null?c.context=f:c.pendingContext=f,c=fs(i),c.payload={element:r},m=m===void 0?null:m,m!==null&&(c.callback=m),r=hs(n,c,i),r!==null&&(mi(r,n,i),ul(r,n,i))}function P_(n,i){if(n=n.memoizedState,n!==null&&n.dehydrated!==null){var r=n.retryLane;n.retryLane=r!==0&&r<i?r:i}}function bd(n,i){P_(n,i),(n=n.alternate)&&P_(n,i)}function B_(n){if(n.tag===13||n.tag===31){var i=Ks(n,67108864);i!==null&&mi(i,n,67108864),bd(n,67108864)}}function I_(n){if(n.tag===13||n.tag===31){var i=Ai();i=qo(i);var r=Ks(n,i);r!==null&&mi(r,n,i),bd(n,i)}}var xu=!0;function Cb(n,i,r,c){var f=F.T;F.T=null;var m=N.p;try{N.p=2,Ed(n,i,r,c)}finally{N.p=m,F.T=f}}function Db(n,i,r,c){var f=F.T;F.T=null;var m=N.p;try{N.p=8,Ed(n,i,r,c)}finally{N.p=m,F.T=f}}function Ed(n,i,r,c){if(xu){var f=Td(c);if(f===null)ud(n,i,c,yu,r),F_(n,c);else if(Lb(f,n,i,r,c))c.stopPropagation();else if(F_(n,c),i&4&&-1<Ub.indexOf(n)){for(;f!==null;){var m=xa(f);if(m!==null)switch(m.tag){case 3:if(m=m.stateNode,m.current.memoizedState.isDehydrated){var S=Nt(m.pendingLanes);if(S!==0){var R=m;for(R.pendingLanes|=2,R.entangledLanes|=2;S;){var G=1<<31-Yt(S);R.entanglements[1]|=G,S&=~G}oa(m),(Ve&6)===0&&(nu=Me()+500,Al(0))}}break;case 31:case 13:R=Ks(m,2),R!==null&&mi(R,m,2),au(),bd(m,2)}if(m=Td(c),m===null&&ud(n,i,c,yu,r),m===f)break;f=m}f!==null&&c.stopPropagation()}else ud(n,i,c,null,r)}}function Td(n){return n=wf(n),Ad(n)}var yu=null;function Ad(n){if(yu=null,n=_a(n),n!==null){var i=l(n);if(i===null)n=null;else{var r=i.tag;if(r===13){if(n=u(i),n!==null)return n;n=null}else if(r===31){if(n=h(i),n!==null)return n;n=null}else if(r===3){if(i.stateNode.current.memoizedState.isDehydrated)return i.tag===3?i.stateNode.containerInfo:null;n=null}else i!==n&&(n=null)}}return yu=n,null}function z_(n){switch(n){case"beforetoggle":case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"toggle":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 2;case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 8;case"message":switch(we()){case B:return 2;case E:return 8;case tt:case ot:return 32;case gt:return 268435456;default:return 32}default:return 32}}var wd=!1,bs=null,Es=null,Ts=null,Nl=new Map,Ol=new Map,As=[],Ub="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");function F_(n,i){switch(n){case"focusin":case"focusout":bs=null;break;case"dragenter":case"dragleave":Es=null;break;case"mouseover":case"mouseout":Ts=null;break;case"pointerover":case"pointerout":Nl.delete(i.pointerId);break;case"gotpointercapture":case"lostpointercapture":Ol.delete(i.pointerId)}}function Pl(n,i,r,c,f,m){return n===null||n.nativeEvent!==m?(n={blockedOn:i,domEventName:r,eventSystemFlags:c,nativeEvent:m,targetContainers:[f]},i!==null&&(i=xa(i),i!==null&&B_(i)),n):(n.eventSystemFlags|=c,i=n.targetContainers,f!==null&&i.indexOf(f)===-1&&i.push(f),n)}function Lb(n,i,r,c,f){switch(i){case"focusin":return bs=Pl(bs,n,i,r,c,f),!0;case"dragenter":return Es=Pl(Es,n,i,r,c,f),!0;case"mouseover":return Ts=Pl(Ts,n,i,r,c,f),!0;case"pointerover":var m=f.pointerId;return Nl.set(m,Pl(Nl.get(m)||null,n,i,r,c,f)),!0;case"gotpointercapture":return m=f.pointerId,Ol.set(m,Pl(Ol.get(m)||null,n,i,r,c,f)),!0}return!1}function H_(n){var i=_a(n.target);if(i!==null){var r=l(i);if(r!==null){if(i=r.tag,i===13){if(i=u(r),i!==null){n.blockedOn=i,wr(n.priority,function(){I_(r)});return}}else if(i===31){if(i=h(r),i!==null){n.blockedOn=i,wr(n.priority,function(){I_(r)});return}}else if(i===3&&r.stateNode.current.memoizedState.isDehydrated){n.blockedOn=r.tag===3?r.stateNode.containerInfo:null;return}}}n.blockedOn=null}function Su(n){if(n.blockedOn!==null)return!1;for(var i=n.targetContainers;0<i.length;){var r=Td(n.nativeEvent);if(r===null){r=n.nativeEvent;var c=new r.constructor(r.type,r);Af=c,r.target.dispatchEvent(c),Af=null}else return i=xa(r),i!==null&&B_(i),n.blockedOn=r,!1;i.shift()}return!0}function G_(n,i,r){Su(n)&&r.delete(i)}function Nb(){wd=!1,bs!==null&&Su(bs)&&(bs=null),Es!==null&&Su(Es)&&(Es=null),Ts!==null&&Su(Ts)&&(Ts=null),Nl.forEach(G_),Ol.forEach(G_)}function Mu(n,i){n.blockedOn===i&&(n.blockedOn=null,wd||(wd=!0,s.unstable_scheduleCallback(s.unstable_NormalPriority,Nb)))}var bu=null;function V_(n){bu!==n&&(bu=n,s.unstable_scheduleCallback(s.unstable_NormalPriority,function(){bu===n&&(bu=null);for(var i=0;i<n.length;i+=3){var r=n[i],c=n[i+1],f=n[i+2];if(typeof c!="function"){if(Ad(c||r)===null)continue;break}var m=xa(r);m!==null&&(n.splice(i,3),i-=3,Th(m,{pending:!0,data:f,method:r.method,action:c},c,f))}}))}function ao(n){function i(G){return Mu(G,n)}bs!==null&&Mu(bs,n),Es!==null&&Mu(Es,n),Ts!==null&&Mu(Ts,n),Nl.forEach(i),Ol.forEach(i);for(var r=0;r<As.length;r++){var c=As[r];c.blockedOn===n&&(c.blockedOn=null)}for(;0<As.length&&(r=As[0],r.blockedOn===null);)H_(r),r.blockedOn===null&&As.shift();if(r=(n.ownerDocument||n).$$reactFormReplay,r!=null)for(c=0;c<r.length;c+=3){var f=r[c],m=r[c+1],S=f[zn]||null;if(typeof m=="function")S||V_(r);else if(S){var R=null;if(m&&m.hasAttribute("formAction")){if(f=m,S=m[zn]||null)R=S.formAction;else if(Ad(f)!==null)continue}else R=S.action;typeof R=="function"?r[c+1]=R:(r.splice(c,3),c-=3),V_(r)}}}function k_(){function n(m){m.canIntercept&&m.info==="react-transition"&&m.intercept({handler:function(){return new Promise(function(S){return f=S})},focusReset:"manual",scroll:"manual"})}function i(){f!==null&&(f(),f=null),c||setTimeout(r,20)}function r(){if(!c&&!navigation.transition){var m=navigation.currentEntry;m&&m.url!=null&&navigation.navigate(m.url,{state:m.getState(),info:"react-transition",history:"replace"})}}if(typeof navigation=="object"){var c=!1,f=null;return navigation.addEventListener("navigate",n),navigation.addEventListener("navigatesuccess",i),navigation.addEventListener("navigateerror",i),setTimeout(r,100),function(){c=!0,navigation.removeEventListener("navigate",n),navigation.removeEventListener("navigatesuccess",i),navigation.removeEventListener("navigateerror",i),f!==null&&(f(),f=null)}}}function Rd(n){this._internalRoot=n}Eu.prototype.render=Rd.prototype.render=function(n){var i=this._internalRoot;if(i===null)throw Error(a(409));var r=i.current,c=Ai();O_(r,c,n,i,null,null)},Eu.prototype.unmount=Rd.prototype.unmount=function(){var n=this._internalRoot;if(n!==null){this._internalRoot=null;var i=n.containerInfo;O_(n.current,2,null,n,null,null),au(),i[ci]=null}};function Eu(n){this._internalRoot=n}Eu.prototype.unstable_scheduleHydration=function(n){if(n){var i=Zo();n={blockedOn:null,target:n,priority:i};for(var r=0;r<As.length&&i!==0&&i<As[r].priority;r++);As.splice(r,0,n),r===0&&H_(n)}};var X_=t.version;if(X_!=="19.2.6")throw Error(a(527,X_,"19.2.6"));N.findDOMNode=function(n){var i=n._reactInternals;if(i===void 0)throw typeof n.render=="function"?Error(a(188)):(n=Object.keys(n).join(","),Error(a(268,n)));return n=p(i),n=n!==null?g(n):null,n=n===null?null:n.stateNode,n};var Ob={bundleType:0,version:"19.2.6",rendererPackageName:"react-dom",currentDispatcherRef:F,reconcilerVersion:"19.2.6"};if(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__<"u"){var Tu=__REACT_DEVTOOLS_GLOBAL_HOOK__;if(!Tu.isDisabled&&Tu.supportsFiber)try{pt=Tu.inject(Ob),vt=Tu}catch{}}return Il.createRoot=function(n,i){if(!o(n))throw Error(a(299));var r=!1,c="",f=Q0,m=$0,S=j0;return i!=null&&(i.unstable_strictMode===!0&&(r=!0),i.identifierPrefix!==void 0&&(c=i.identifierPrefix),i.onUncaughtError!==void 0&&(f=i.onUncaughtError),i.onCaughtError!==void 0&&(m=i.onCaughtError),i.onRecoverableError!==void 0&&(S=i.onRecoverableError)),i=L_(n,1,!1,null,null,r,c,null,f,m,S,k_),n[ci]=i.current,cd(n),new Rd(i)},Il.hydrateRoot=function(n,i,r){if(!o(n))throw Error(a(299));var c=!1,f="",m=Q0,S=$0,R=j0,G=null;return r!=null&&(r.unstable_strictMode===!0&&(c=!0),r.identifierPrefix!==void 0&&(f=r.identifierPrefix),r.onUncaughtError!==void 0&&(m=r.onUncaughtError),r.onCaughtError!==void 0&&(S=r.onCaughtError),r.onRecoverableError!==void 0&&(R=r.onRecoverableError),r.formState!==void 0&&(G=r.formState)),i=L_(n,1,!0,i,r??null,c,f,G,m,S,R,k_),i.context=N_(null),r=i.current,c=Ai(),c=qo(c),f=fs(c),f.callback=null,hs(r,f,c),r=c,i.current.lanes=r,Qt(i,r),oa(i),n[ci]=i.current,cd(n),new Eu(i)},Il.version="19.2.6",Il}var tx;function Xb(){if(tx)return Dd.exports;tx=1;function s(){if(!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__>"u"||typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE!="function"))try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(s)}catch(t){console.error(t)}}return s(),Dd.exports=kb(),Dd.exports}var Wb=Xb(),Pd=wm();const qb="/assets/forest-DJWUUm5V.jpg",Yb="/assets/hills-CQMtR0L1.jpg",Zb="/assets/pasture-DOnoBB0U.jpg",Kb="/assets/field-B2YrAcLn.jpg",Jb="/assets/mountain-DsPHlnML.jpg",Qb="/assets/goldmine-kwt6AbPi.jpg",$b="/assets/desert-VK-P4HSK.jpg",jb="/assets/ocean-DPc2vE9K.jpg",tE="/assets/gems_spritesheet-kMccKuPA.png",eE={forest:qb,hills:Yb,pasture:Zb,field:Kb,mountain:Jb,goldmine:Qb,desert:$b,ocean:jb},jn={wood:{name:"Wood",icon:"🪵",c1:"#6b3410",c2:"#c47a2c",ring:"#e6ad63",gem:"#c07b34"},brick:{name:"Brick",icon:"🧱",c1:"#a01808",c2:"#ff5636",ring:"#f59468",gem:"#e8442a"},sheep:{name:"Sheep",icon:"🐑",c1:"#1f7a1c",c2:"#6fe04a",ring:"#b4ec8f",gem:"#4ecb3e"},wheat:{name:"Wheat",icon:"🌾",c1:"#b89400",c2:"#ffe83a",ring:"#ffec93",gem:"#f5da28"},ore:{name:"Ore",icon:"⛏️",c1:"#284a9c",c2:"#5aa8ff",ring:"#c1cfe2",gem:"#3f7fe0"},gold:{name:"Gold",icon:"🪙",c1:"#9c5a02",c2:"#ffb01f",ring:"#ffcf6e",gem:"#f5921f"}},Rm=tE,ic=6,Cm={sheep:0,wood:1,brick:2,wheat:3,ore:4,gold:5},Vi=["wood","brick","sheep","wheat","ore","gold"],cf={forest:{name:"Forest",res:"wood"},hills:{name:"Hills",res:"brick"},pasture:{name:"Pasture",res:"sheep"},field:{name:"Field",res:"wheat"},mountain:{name:"Mountain",res:"ore"},goldmine:{name:"Gold Mine",res:"gold"},desert:{name:"Desert",res:null}};[...Array(6).fill("forest"),...Array(5).fill("hills"),...Array(6).fill("pasture"),...Array(6).fill("field"),...Array(4).fill("mountain"),...Array(2).fill("goldmine"),...Array(1).fill("desert")];const Ln={road:{cost:{wood:1,brick:1},vp:0,label:"Rail"},settlement:{cost:{wood:1,brick:1,sheep:1,wheat:1},vp:1,label:"Factory"},city:{cost:{wheat:2,ore:3},vp:2,label:"Foundry"}},Dm={target:10},dr={wood:1,brick:1,wheat:1,ore:1},ti={bandit:{name:"Blockade",gold:5,target:"tile",desc:"Picket a district for 45s — no one adjacent may harvest it."},harden:{name:"Frost Tiles",gold:5,target:"player",desc:"Freeze 7 gems in ice (2 matches to shatter)."},block:{name:"Iron Girders",gold:9,target:"player",desc:"Drop 2 immovable girders for 2 minutes."},fog:{name:"Smog Cloud",gold:7,target:"player",desc:"Choke a rival's board with smog for 30s (no swaps)."}},Wa={gold:6,ms:9e4,name:"Security Forces",desc:"Hire guards for 90s — immune to Blockade & Smog Cloud."},nE=6,kn=9,In=9,ha=54,ex=2e4,iE=4e4,Ro=220,aE=45e3,nx=12e4,ix=3e4,ax=12e4,gr=(s=1)=>Math.random()*s,Bo=s=>Math.floor(Math.random()*s),Ya=s=>s[Bo(s.length)];function Bd(s){const t=s.slice();for(let e=t.length-1;e>0;e--){const a=Bo(e+1);[t[e],t[a]]=[t[a],t[e]]}return t}function sx(s){let t=s>>>0;return()=>{t|=0,t=t+1831565813|0;let e=Math.imul(t^t>>>15,1|t);return e=e+Math.imul(e^e>>>7,61|e)^e,((e^e>>>14)>>>0)/4294967296}}class sE{t=new EventTarget;on(t,e){const a=o=>e(o.detail);return this.t.addEventListener(t,a),()=>this.t.removeEventListener(t,a)}emit(t,e){this.t.dispatchEvent(new CustomEvent(t,{detail:e}))}}const Kt=new sE;function rE(s,t,e,a){return{i:s,name:t,human:e,color:a,res:{wood:0,brick:0,sheep:0,wheat:0,ore:0,gold:0},settlements:[],cities:[],roads:[],capital:-1,tollAccess:new Set,vp:0,skill:e?1:.55+Math.random()*.35,nextIncome:5e3+Math.random()*4e3,nextBuild:1e4+Math.random()*6e3,nextTrade:12e3+Math.random()*15e3,nextEvil:45e3+Math.random()*3e4,slowedUntil:0,securedUntil:0,lastGain:{}}}const $={players:[],map:null,board:null,view:null,offers:[],offerSeq:1,setupPhase:!0,buildMode:null,pendingSabotage:null,running:!1,won:!1,upgradeTimer:0};function oE(s){let t=0;for(let e=0;e<s.length;e++){const a=(e+1)%s.length;t+=s[e][0]*s[a][1]-s[a][0]*s[e][1]}return Math.abs(t)/2}function rx(s){let t=0,e=0,a=0;for(let o=0;o<s.length;o++){const l=(o+1)%s.length,u=s[o][0]*s[l][1]-s[l][0]*s[o][1];t+=(s[o][0]+s[l][0])*u,e+=(s[o][1]+s[l][1])*u,a+=u}return Math.abs(a)<1e-6?[s[0][0],s[0][1]]:(a*=3,[t/a,e/a])}function lE(s,t,e,a,o){const l=[],u=h=>(h[0]-t)*a+(h[1]-e)*o;for(let h=0;h<s.length;h++){const d=s[h],p=s[(h+1)%s.length],g=u(d),_=u(p);if(g<=0&&l.push(d),g<0&&_>0||g>0&&_<0){const v=g/(g-_);l.push([d[0]+v*(p[0]-d[0]),d[1]+v*(p[1]-d[1])])}}return l}function cE(s,t,e){let a=0;for(let o=0;o<s.length;o++){const l=s[o],u=s[(o+1)%s.length],h=(u[0]-l[0])*(e-l[1])-(u[1]-l[1])*(t-l[0]);if(h!==0){const d=h>0?1:-1;if(a===0)a=d;else if(d!==a)return!1}}return!0}const ox=["forest","hills","pasture","field","mountain","goldmine"],uE={forest:22,pasture:22,field:20,hills:18,mountain:14,goldmine:4};function fE(s){const t=(Date.now()&2147483647)>>>0,e=sx(t^40503),a=Ro,o=[],l=e()*Math.PI;for(let N=0;N<3;N++){const V=a*(2.2+e()*.8),nt=l+N*2*Math.PI/3+(e()-.5)*.7,mt=a*(1.2+e()*.7),L=Math.cos(nt)*mt,X=Math.sin(nt)*mt,_t=e()*Math.PI,Ct=[];for(let Lt=0;Lt<6;Lt++){const et=_t+Lt*Math.PI/3;Ct.push([L+Math.cos(et)*V,X+Math.sin(et)*V])}o.push(Ct)}const u=(N,V)=>o.some(nt=>cE(nt,N,V));let h=1/0,d=1/0,p=-1/0,g=-1/0;for(const N of o)for(const V of N)h=Math.min(h,V[0]),d=Math.min(d,V[1]),p=Math.max(p,V[0]),g=Math.max(g,V[1]);const _=a*.55,v={minX:h-_,minY:d-_,maxX:p+_,maxY:g+_},x=a*.8,b=x*.36,C=[];for(let N=v.minY;N<=v.maxY;N+=x)for(let V=v.minX;V<=v.maxX;V+=x)C.push({x:V+(e()-.5)*b,y:N+(e()-.5)*b});const M=N=>{let V=[[v.minX,v.minY],[v.maxX,v.minY],[v.maxX,v.maxY],[v.minX,v.maxY]];const nt=C[N];for(let mt=0;mt<C.length&&V.length;mt++){if(mt===N)continue;const L=C[mt],X=L.x-nt.x,_t=L.y-nt.y;V=lE(V,(L.x+nt.x)/2,(L.y+nt.y)/2,X,_t)}return V};for(let N=0;N<2;N++)for(let V=0;V<C.length;V++){const nt=M(V);if(nt.length>=3){const mt=rx(nt);C[V].x=mt[0],C[V].y=mt[1]}}const y=[],I=[],D=[],A=new Map,O=new Map,U=(N,V)=>`${Math.round(N/7)},${Math.round(V/7)}`,z=(N,V)=>{const nt=U(N,V);if(A.has(nt))return A.get(nt);const mt=y.length;return y.push({i:mt,x:N,y:V,tiles:[],edges:[],building:null,owner:-1,buildable:!1}),A.set(nt,mt),mt},T=(N,V,nt)=>{const mt=N<V?`${N}-${V}`:`${V}-${N}`;let L=O.get(mt);if(L===void 0){const X=y[N],_t=y[V];L=I.length,I.push({i:L,a:N,b:V,x:(X.x+_t.x)/2,y:(X.y+_t.y)/2,owner:-1,tiles:[],rail:!1,wob:[]}),O.set(mt,L),X.edges.includes(L)||X.edges.push(L),_t.edges.includes(L)||_t.edges.push(L)}return I[L].tiles.includes(nt)||I[L].tiles.push(nt),L};for(let N=0;N<C.length;N++){if(!u(C[N].x,C[N].y))continue;const V=M(N);if(V.length<3)continue;const nt=oE(V);if(nt<3e3)continue;const mt=D.length,L=V.map(et=>z(et[0],et[1])),X=[];for(let et=0;et<L.length;et++)L[et]!==X[X.length-1]&&X.push(L[et]);if(X.length>1&&X[0]===X[X.length-1]&&X.pop(),X.length<3)continue;const[_t,Ct]=rx(V),Lt={i:mt,x:_t,y:Ct,type:"field",verts:X,edges:[],area:nt,banditUntil:0};X.forEach(et=>{y[et].tiles.includes(mt)||y[et].tiles.push(mt)});for(let et=0;et<X.length;et++){const Mt=T(X[et],X[(et+1)%X.length],mt);Lt.edges.includes(Mt)||Lt.edges.push(Mt)}D.push(Lt)}const P=D.map(N=>N.area).sort((N,V)=>N-V),k=P.length?P[Math.floor(P.length*.16)]*.9:12e3,H=[];ox.forEach(N=>{for(let V=0;V<uE[N];V++)H.push(N)});for(const N of D){if(N.area<k){N.type="desert";continue}N.type=H[Math.floor(e()*H.length)]}const K=D.filter(N=>N.area>=k);for(const N of ox)if(!K.some(V=>V.type===N)){const V=K.find(nt=>nt.type!=="goldmine");V&&(V.type=N)}for(const N of I)N.rail=N.tiles.length===2;for(const N of y){const V=N.edges.reduce((nt,mt)=>nt+(I[mt].rail?1:0),0);N.buildable=N.tiles.length>=3&&V>=3}for(const N of I){const V=y[N.a],nt=y[N.b],mt=4,L=nt.x-V.x,X=nt.y-V.y,_t=Math.hypot(L,X)||1,Ct=-X/_t,Lt=L/_t,et=Math.min(_t*.22,Ro*.16),Mt=sx(N.a*73856093^N.b*19349663^12139);N.wob=[];for(let Et=1;Et<mt;Et++){const zt=Et/mt,oe=Math.sin(zt*Math.PI),ae=(Mt()-.5)*2*et*oe;N.wob.push([V.x+L*zt+Ct*ae,V.y+X*zt+Lt*ae])}}let ft=1/0,dt=1/0,J=-1/0,F=-1/0;return D.forEach(N=>N.verts.forEach(V=>{const nt=y[V];ft=Math.min(ft,nt.x),dt=Math.min(dt,nt.y),J=Math.max(J,nt.x),F=Math.max(F,nt.y)})),{tiles:D,verts:y,edges:I,bounds:{minX:ft,minY:dt,maxX:J,maxY:F}}}function Cy(s,t){return s.verts[t].edges.map(a=>s.edges[a].a===t?s.edges[a].b:s.edges[a].a)}function Um(s,t){const e=new Set;if(t.capital<0||!s.verts[t.capital])return e;e.add(t.capital);const a=[t.capital];for(;a.length;){const o=a.shift();for(const l of s.verts[o].edges){const u=s.edges[l];if(!(u.owner===t.i||u.owner>=0&&t.tollAccess.has(u.owner)))continue;const d=u.a===o?u.b:u.a;e.has(d)||(e.add(d),a.push(d))}}return e}function ac(s,t,e,a){const o=s.verts[e];if(!o||o.building||!o.buildable)return!1;for(const l of Cy(s,e))if(s.verts[l].building)return!1;return a?!0:Um(s,t).has(e)}function sc(s,t,e){const a=s.edges[e];if(!a||a.owner!==-1||!a.rail)return!1;const o=Um(s,t);return o.has(a.a)||o.has(a.b)}function Lm(s,t,e){const a=s.edges[e];if(!a||a.owner<0||a.owner===t.i||t.tollAccess.has(a.owner))return-1;const o=Um(s,t);return!o.has(a.a)&&!o.has(a.b)?-1:a.owner}function Dy(s,t,e){const a=s.verts[e];return a.building==="settlement"&&a.owner===t.i}function Nm(s,t,e){const a={},o=(l,u)=>{if(!(l<0||!s.verts[l]))for(const h of s.verts[l].tiles){const d=s.tiles[h];if(!d||d.banditUntil>e)continue;const p=cf[d.type].res;p&&(a[p]=Math.max(a[p]??0,u))}};return t.capital>=0&&o(t.capital,1),t.settlements.forEach(l=>o(l,1)),t.cities.forEach(l=>o(l,2)),a}function lx(s,t){const e=[],a=t.verts.length;for(let o=0;o<a;o++){const l=t.verts[o],u=t.verts[(o+1)%a],h=s.verts[l];e.push([h.x,h.y]);const d=h.edges.find(p=>{const g=s.edges[p];return g.a===l&&g.b===u||g.a===u&&g.b===l});if(d!==void 0){const p=s.edges[d];if(p.a===l)for(const g of p.wob)e.push(g);else for(let g=p.wob.length-1;g>=0;g--)e.push(p.wob[g])}}return e}const Om="185",hE=0,cx=1,dE=2,tf=1,Uy=2,Kl=3,Fs=0,ni=1,$i=2,Za=0,No=1,ux=2,fx=3,hx=4,pE=5,pr=100,mE=101,gE=102,vE=103,_E=104,xE=200,yE=201,SE=202,ME=203,wp=204,Rp=205,bE=206,EE=207,TE=208,AE=209,wE=210,RE=211,CE=212,DE=213,UE=214,Cp=0,Dp=1,Up=2,Io=3,Lp=4,Np=5,Op=6,Pp=7,Pm=0,LE=1,NE=2,pa=0,Ly=1,Ny=2,Oy=3,Py=4,By=5,Iy=6,Bm=7,zy=300,yr=301,zo=302,Id=303,zd=304,bf=306,Fo=1e3,qa=1001,Bp=1002,qn=1003,OE=1004,Au=1005,ei=1006,Fd=1007,vr=1008,Di=1009,Fy=1010,Hy=1011,rc=1012,Im=1013,ga=1014,ji=1015,$a=1016,zm=1017,Fm=1018,oc=1020,Gy=35902,Vy=35899,ky=1021,Xy=1022,ta=1023,ja=1026,_r=1027,Hm=1028,Gm=1029,Sr=1030,Vm=1031,km=1033,ef=33776,nf=33777,af=33778,sf=33779,Ip=35840,zp=35841,Fp=35842,Hp=35843,Gp=36196,Vp=37492,kp=37496,Xp=37488,Wp=37489,uf=37490,qp=37491,Yp=37808,Zp=37809,Kp=37810,Jp=37811,Qp=37812,$p=37813,jp=37814,tm=37815,em=37816,nm=37817,im=37818,am=37819,sm=37820,rm=37821,om=36492,lm=36494,cm=36495,um=36283,fm=36284,ff=36285,hm=36286,PE=3200,hf=0,BE=1,Ps="",Xn="srgb",df="srgb-linear",pf="linear",Je="srgb",so=7680,dx=519,IE=512,zE=513,FE=514,Xm=515,HE=516,GE=517,Wm=518,VE=519,dm=35044,px="300 es",da=2e3,lc=2001;function kE(s){for(let t=s.length-1;t>=0;--t)if(s[t]>=65535)return!0;return!1}function cc(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}function XE(){const s=cc("canvas");return s.style.display="block",s}const mx={};function mf(...s){const t="THREE."+s.shift();console.log(t,...s)}function Wy(s){const t=s[0];if(typeof t=="string"&&t.startsWith("TSL:")){const e=s[1];e&&e.isStackTrace?s[0]+=" "+e.getLocation():s[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return s}function ge(...s){s=Wy(s);const t="THREE."+s.shift();{const e=s[0];e&&e.isStackTrace?console.warn(e.getError(t)):console.warn(t,...s)}}function Oe(...s){s=Wy(s);const t="THREE."+s.shift();{const e=s[0];e&&e.isStackTrace?console.error(e.getError(t)):console.error(t,...s)}}function Oo(...s){const t=s.join(" ");t in mx||(mx[t]=!0,ge(...s))}function WE(s,t,e){return new Promise(function(a,o){function l(){switch(s.clientWaitSync(t,s.SYNC_FLUSH_COMMANDS_BIT,0)){case s.WAIT_FAILED:o();break;case s.TIMEOUT_EXPIRED:setTimeout(l,e);break;default:a()}}setTimeout(l,e)})}const qE={[Cp]:Dp,[Up]:Op,[Lp]:Pp,[Io]:Np,[Dp]:Cp,[Op]:Up,[Pp]:Lp,[Np]:Io};class Er{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const a=this._listeners;a[t]===void 0&&(a[t]=[]),a[t].indexOf(e)===-1&&a[t].push(e)}hasEventListener(t,e){const a=this._listeners;return a===void 0?!1:a[t]!==void 0&&a[t].indexOf(e)!==-1}removeEventListener(t,e){const a=this._listeners;if(a===void 0)return;const o=a[t];if(o!==void 0){const l=o.indexOf(e);l!==-1&&o.splice(l,1)}}dispatchEvent(t){const e=this._listeners;if(e===void 0)return;const a=e[t.type];if(a!==void 0){t.target=this;const o=a.slice(0);for(let l=0,u=o.length;l<u;l++)o[l].call(this,t);t.target=null}}}const Jn=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],Hd=Math.PI/180,pm=180/Math.PI;function Ka(){const s=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,a=Math.random()*4294967295|0;return(Jn[s&255]+Jn[s>>8&255]+Jn[s>>16&255]+Jn[s>>24&255]+"-"+Jn[t&255]+Jn[t>>8&255]+"-"+Jn[t>>16&15|64]+Jn[t>>24&255]+"-"+Jn[e&63|128]+Jn[e>>8&255]+"-"+Jn[e>>16&255]+Jn[e>>24&255]+Jn[a&255]+Jn[a>>8&255]+Jn[a>>16&255]+Jn[a>>24&255]).toLowerCase()}function Ue(s,t,e){return Math.max(t,Math.min(e,s))}function YE(s,t){return(s%t+t)%t}function Gd(s,t,e){return(1-e)*s+e*t}function fa(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("THREE.MathUtils: Invalid component type.")}}function tn(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("THREE.MathUtils: Invalid component type.")}}const lg=class lg{constructor(t=0,e=0){this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("THREE.Vector2: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("THREE.Vector2: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,a=this.y,o=t.elements;return this.x=o[0]*e+o[3]*a+o[6],this.y=o[1]*e+o[4]*a+o[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Ue(this.x,t.x,e.x),this.y=Ue(this.y,t.y,e.y),this}clampScalar(t,e){return this.x=Ue(this.x,t,e),this.y=Ue(this.y,t,e),this}clampLength(t,e){const a=this.length();return this.divideScalar(a||1).multiplyScalar(Ue(a,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const a=this.dot(t)/e;return Math.acos(Ue(a,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,a=this.y-t.y;return e*e+a*a}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,a){return this.x=t.x+(e.x-t.x)*a,this.y=t.y+(e.y-t.y)*a,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const a=Math.cos(e),o=Math.sin(e),l=this.x-t.x,u=this.y-t.y;return this.x=l*a-u*o+t.x,this.y=l*o+u*a+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}};lg.prototype.isVector2=!0;let Ut=lg;class Xo{constructor(t=0,e=0,a=0,o=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=a,this._w=o}static slerpFlat(t,e,a,o,l,u,h){let d=a[o+0],p=a[o+1],g=a[o+2],_=a[o+3],v=l[u+0],x=l[u+1],b=l[u+2],C=l[u+3];if(_!==C||d!==v||p!==x||g!==b){let M=d*v+p*x+g*b+_*C;M<0&&(v=-v,x=-x,b=-b,C=-C,M=-M);let y=1-h;if(M<.9995){const I=Math.acos(M),D=Math.sin(I);y=Math.sin(y*I)/D,h=Math.sin(h*I)/D,d=d*y+v*h,p=p*y+x*h,g=g*y+b*h,_=_*y+C*h}else{d=d*y+v*h,p=p*y+x*h,g=g*y+b*h,_=_*y+C*h;const I=1/Math.sqrt(d*d+p*p+g*g+_*_);d*=I,p*=I,g*=I,_*=I}}t[e]=d,t[e+1]=p,t[e+2]=g,t[e+3]=_}static multiplyQuaternionsFlat(t,e,a,o,l,u){const h=a[o],d=a[o+1],p=a[o+2],g=a[o+3],_=l[u],v=l[u+1],x=l[u+2],b=l[u+3];return t[e]=h*b+g*_+d*x-p*v,t[e+1]=d*b+g*v+p*_-h*x,t[e+2]=p*b+g*x+h*v-d*_,t[e+3]=g*b-h*_-d*v-p*x,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,a,o){return this._x=t,this._y=e,this._z=a,this._w=o,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const a=t._x,o=t._y,l=t._z,u=t._order,h=Math.cos,d=Math.sin,p=h(a/2),g=h(o/2),_=h(l/2),v=d(a/2),x=d(o/2),b=d(l/2);switch(u){case"XYZ":this._x=v*g*_+p*x*b,this._y=p*x*_-v*g*b,this._z=p*g*b+v*x*_,this._w=p*g*_-v*x*b;break;case"YXZ":this._x=v*g*_+p*x*b,this._y=p*x*_-v*g*b,this._z=p*g*b-v*x*_,this._w=p*g*_+v*x*b;break;case"ZXY":this._x=v*g*_-p*x*b,this._y=p*x*_+v*g*b,this._z=p*g*b+v*x*_,this._w=p*g*_-v*x*b;break;case"ZYX":this._x=v*g*_-p*x*b,this._y=p*x*_+v*g*b,this._z=p*g*b-v*x*_,this._w=p*g*_+v*x*b;break;case"YZX":this._x=v*g*_+p*x*b,this._y=p*x*_+v*g*b,this._z=p*g*b-v*x*_,this._w=p*g*_-v*x*b;break;case"XZY":this._x=v*g*_-p*x*b,this._y=p*x*_-v*g*b,this._z=p*g*b+v*x*_,this._w=p*g*_+v*x*b;break;default:ge("Quaternion: .setFromEuler() encountered an unknown order: "+u)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const a=e/2,o=Math.sin(a);return this._x=t.x*o,this._y=t.y*o,this._z=t.z*o,this._w=Math.cos(a),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,a=e[0],o=e[4],l=e[8],u=e[1],h=e[5],d=e[9],p=e[2],g=e[6],_=e[10],v=a+h+_;if(v>0){const x=.5/Math.sqrt(v+1);this._w=.25/x,this._x=(g-d)*x,this._y=(l-p)*x,this._z=(u-o)*x}else if(a>h&&a>_){const x=2*Math.sqrt(1+a-h-_);this._w=(g-d)/x,this._x=.25*x,this._y=(o+u)/x,this._z=(l+p)/x}else if(h>_){const x=2*Math.sqrt(1+h-a-_);this._w=(l-p)/x,this._x=(o+u)/x,this._y=.25*x,this._z=(d+g)/x}else{const x=2*Math.sqrt(1+_-a-h);this._w=(u-o)/x,this._x=(l+p)/x,this._y=(d+g)/x,this._z=.25*x}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let a=t.dot(e)+1;return a<1e-8?(a=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=a):(this._x=0,this._y=-t.z,this._z=t.y,this._w=a)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=a),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Ue(this.dot(t),-1,1)))}rotateTowards(t,e){const a=this.angleTo(t);if(a===0)return this;const o=Math.min(1,e/a);return this.slerp(t,o),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const a=t._x,o=t._y,l=t._z,u=t._w,h=e._x,d=e._y,p=e._z,g=e._w;return this._x=a*g+u*h+o*p-l*d,this._y=o*g+u*d+l*h-a*p,this._z=l*g+u*p+a*d-o*h,this._w=u*g-a*h-o*d-l*p,this._onChangeCallback(),this}slerp(t,e){let a=t._x,o=t._y,l=t._z,u=t._w,h=this.dot(t);h<0&&(a=-a,o=-o,l=-l,u=-u,h=-h);let d=1-e;if(h<.9995){const p=Math.acos(h),g=Math.sin(p);d=Math.sin(d*p)/g,e=Math.sin(e*p)/g,this._x=this._x*d+a*e,this._y=this._y*d+o*e,this._z=this._z*d+l*e,this._w=this._w*d+u*e,this._onChangeCallback()}else this._x=this._x*d+a*e,this._y=this._y*d+o*e,this._z=this._z*d+l*e,this._w=this._w*d+u*e,this.normalize();return this}slerpQuaternions(t,e,a){return this.copy(t).slerp(e,a)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),a=Math.random(),o=Math.sqrt(1-a),l=Math.sqrt(a);return this.set(o*Math.sin(t),o*Math.cos(t),l*Math.sin(e),l*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}const cg=class cg{constructor(t=0,e=0,a=0){this.x=t,this.y=e,this.z=a}set(t,e,a){return a===void 0&&(a=this.z),this.x=t,this.y=e,this.z=a,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("THREE.Vector3: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("THREE.Vector3: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(gx.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(gx.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,a=this.y,o=this.z,l=t.elements;return this.x=l[0]*e+l[3]*a+l[6]*o,this.y=l[1]*e+l[4]*a+l[7]*o,this.z=l[2]*e+l[5]*a+l[8]*o,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,a=this.y,o=this.z,l=t.elements,u=1/(l[3]*e+l[7]*a+l[11]*o+l[15]);return this.x=(l[0]*e+l[4]*a+l[8]*o+l[12])*u,this.y=(l[1]*e+l[5]*a+l[9]*o+l[13])*u,this.z=(l[2]*e+l[6]*a+l[10]*o+l[14])*u,this}applyQuaternion(t){const e=this.x,a=this.y,o=this.z,l=t.x,u=t.y,h=t.z,d=t.w,p=2*(u*o-h*a),g=2*(h*e-l*o),_=2*(l*a-u*e);return this.x=e+d*p+u*_-h*g,this.y=a+d*g+h*p-l*_,this.z=o+d*_+l*g-u*p,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,a=this.y,o=this.z,l=t.elements;return this.x=l[0]*e+l[4]*a+l[8]*o,this.y=l[1]*e+l[5]*a+l[9]*o,this.z=l[2]*e+l[6]*a+l[10]*o,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Ue(this.x,t.x,e.x),this.y=Ue(this.y,t.y,e.y),this.z=Ue(this.z,t.z,e.z),this}clampScalar(t,e){return this.x=Ue(this.x,t,e),this.y=Ue(this.y,t,e),this.z=Ue(this.z,t,e),this}clampLength(t,e){const a=this.length();return this.divideScalar(a||1).multiplyScalar(Ue(a,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,a){return this.x=t.x+(e.x-t.x)*a,this.y=t.y+(e.y-t.y)*a,this.z=t.z+(e.z-t.z)*a,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const a=t.x,o=t.y,l=t.z,u=e.x,h=e.y,d=e.z;return this.x=o*d-l*h,this.y=l*u-a*d,this.z=a*h-o*u,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const a=t.dot(this)/e;return this.copy(t).multiplyScalar(a)}projectOnPlane(t){return Vd.copy(this).projectOnVector(t),this.sub(Vd)}reflect(t){return this.sub(Vd.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const a=this.dot(t)/e;return Math.acos(Ue(a,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,a=this.y-t.y,o=this.z-t.z;return e*e+a*a+o*o}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,a){const o=Math.sin(e)*t;return this.x=o*Math.sin(a),this.y=Math.cos(e)*t,this.z=o*Math.cos(a),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,a){return this.x=t*Math.sin(e),this.y=a,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),a=this.setFromMatrixColumn(t,1).length(),o=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=a,this.z=o,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,a=Math.sqrt(1-e*e);return this.x=a*Math.cos(t),this.y=e,this.z=a*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}};cg.prototype.isVector3=!0;let q=cg;const Vd=new q,gx=new Xo,ug=class ug{constructor(t,e,a,o,l,u,h,d,p){this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,a,o,l,u,h,d,p)}set(t,e,a,o,l,u,h,d,p){const g=this.elements;return g[0]=t,g[1]=o,g[2]=h,g[3]=e,g[4]=l,g[5]=d,g[6]=a,g[7]=u,g[8]=p,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,a=t.elements;return e[0]=a[0],e[1]=a[1],e[2]=a[2],e[3]=a[3],e[4]=a[4],e[5]=a[5],e[6]=a[6],e[7]=a[7],e[8]=a[8],this}extractBasis(t,e,a){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),a.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const a=t.elements,o=e.elements,l=this.elements,u=a[0],h=a[3],d=a[6],p=a[1],g=a[4],_=a[7],v=a[2],x=a[5],b=a[8],C=o[0],M=o[3],y=o[6],I=o[1],D=o[4],A=o[7],O=o[2],U=o[5],z=o[8];return l[0]=u*C+h*I+d*O,l[3]=u*M+h*D+d*U,l[6]=u*y+h*A+d*z,l[1]=p*C+g*I+_*O,l[4]=p*M+g*D+_*U,l[7]=p*y+g*A+_*z,l[2]=v*C+x*I+b*O,l[5]=v*M+x*D+b*U,l[8]=v*y+x*A+b*z,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],a=t[1],o=t[2],l=t[3],u=t[4],h=t[5],d=t[6],p=t[7],g=t[8];return e*u*g-e*h*p-a*l*g+a*h*d+o*l*p-o*u*d}invert(){const t=this.elements,e=t[0],a=t[1],o=t[2],l=t[3],u=t[4],h=t[5],d=t[6],p=t[7],g=t[8],_=g*u-h*p,v=h*d-g*l,x=p*l-u*d,b=e*_+a*v+o*x;if(b===0)return this.set(0,0,0,0,0,0,0,0,0);const C=1/b;return t[0]=_*C,t[1]=(o*p-g*a)*C,t[2]=(h*a-o*u)*C,t[3]=v*C,t[4]=(g*e-o*d)*C,t[5]=(o*l-h*e)*C,t[6]=x*C,t[7]=(a*d-p*e)*C,t[8]=(u*e-a*l)*C,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,a,o,l,u,h){const d=Math.cos(l),p=Math.sin(l);return this.set(a*d,a*p,-a*(d*u+p*h)+u+t,-o*p,o*d,-o*(-p*u+d*h)+h+e,0,0,1),this}scale(t,e){return Oo("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(kd.makeScale(t,e)),this}rotate(t){return Oo("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(kd.makeRotation(-t)),this}translate(t,e){return Oo("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(kd.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),a=Math.sin(t);return this.set(e,-a,0,a,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,a=t.elements;for(let o=0;o<9;o++)if(e[o]!==a[o])return!1;return!0}fromArray(t,e=0){for(let a=0;a<9;a++)this.elements[a]=t[a+e];return this}toArray(t=[],e=0){const a=this.elements;return t[e]=a[0],t[e+1]=a[1],t[e+2]=a[2],t[e+3]=a[3],t[e+4]=a[4],t[e+5]=a[5],t[e+6]=a[6],t[e+7]=a[7],t[e+8]=a[8],t}clone(){return new this.constructor().fromArray(this.elements)}};ug.prototype.isMatrix3=!0;let Se=ug;const kd=new Se,vx=new Se().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),_x=new Se().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function ZE(){const s={enabled:!0,workingColorSpace:df,spaces:{},convert:function(o,l,u){return this.enabled===!1||l===u||!l||!u||(this.spaces[l].transfer===Je&&(o.r=Ja(o.r),o.g=Ja(o.g),o.b=Ja(o.b)),this.spaces[l].primaries!==this.spaces[u].primaries&&(o.applyMatrix3(this.spaces[l].toXYZ),o.applyMatrix3(this.spaces[u].fromXYZ)),this.spaces[u].transfer===Je&&(o.r=Po(o.r),o.g=Po(o.g),o.b=Po(o.b))),o},workingToColorSpace:function(o,l){return this.convert(o,this.workingColorSpace,l)},colorSpaceToWorking:function(o,l){return this.convert(o,l,this.workingColorSpace)},getPrimaries:function(o){return this.spaces[o].primaries},getTransfer:function(o){return o===Ps?pf:this.spaces[o].transfer},getToneMappingMode:function(o){return this.spaces[o].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(o,l=this.workingColorSpace){return o.fromArray(this.spaces[l].luminanceCoefficients)},define:function(o){Object.assign(this.spaces,o)},_getMatrix:function(o,l,u){return o.copy(this.spaces[l].toXYZ).multiply(this.spaces[u].fromXYZ)},_getDrawingBufferColorSpace:function(o){return this.spaces[o].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(o=this.workingColorSpace){return this.spaces[o].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(o,l){return Oo("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),s.workingToColorSpace(o,l)},toWorkingColorSpace:function(o,l){return Oo("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),s.colorSpaceToWorking(o,l)}},t=[.64,.33,.3,.6,.15,.06],e=[.2126,.7152,.0722],a=[.3127,.329];return s.define({[df]:{primaries:t,whitePoint:a,transfer:pf,toXYZ:vx,fromXYZ:_x,luminanceCoefficients:e,workingColorSpaceConfig:{unpackColorSpace:Xn},outputColorSpaceConfig:{drawingBufferColorSpace:Xn}},[Xn]:{primaries:t,whitePoint:a,transfer:Je,toXYZ:vx,fromXYZ:_x,luminanceCoefficients:e,outputColorSpaceConfig:{drawingBufferColorSpace:Xn}}}),s}const Ie=ZE();function Ja(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function Po(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}let ro;class KE{static getDataURL(t,e="image/png"){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let a;if(t instanceof HTMLCanvasElement)a=t;else{ro===void 0&&(ro=cc("canvas")),ro.width=t.width,ro.height=t.height;const o=ro.getContext("2d");t instanceof ImageData?o.putImageData(t,0,0):o.drawImage(t,0,0,t.width,t.height),a=ro}return a.toDataURL(e)}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=cc("canvas");e.width=t.width,e.height=t.height;const a=e.getContext("2d");a.drawImage(t,0,0,t.width,t.height);const o=a.getImageData(0,0,t.width,t.height),l=o.data;for(let u=0;u<l.length;u++)l[u]=Ja(l[u]/255)*255;return a.putImageData(o,0,0),e}else if(t.data){const e=t.data.slice(0);for(let a=0;a<e.length;a++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[a]=Math.floor(Ja(e[a]/255)*255):e[a]=Ja(e[a]);return{data:e,width:t.width,height:t.height}}else return ge("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}}let JE=0;class qm{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:JE++}),this.uuid=Ka(),this.data=t,this.dataReady=!0,this.version=0}getSize(t){const e=this.data;return typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement?t.set(e.videoWidth,e.videoHeight,0):typeof VideoFrame<"u"&&e instanceof VideoFrame?t.set(e.displayWidth,e.displayHeight,0):e!==null?t.set(e.width,e.height,e.depth||0):t.set(0,0,0),t}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const a={uuid:this.uuid,url:""},o=this.data;if(o!==null){let l;if(Array.isArray(o)){l=[];for(let u=0,h=o.length;u<h;u++)o[u].isDataTexture?l.push(Xd(o[u].image)):l.push(Xd(o[u]))}else l=Xd(o);a.url=l}return e||(t.images[this.uuid]=a),a}}function Xd(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?KE.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(ge("Texture: Unable to serialize Texture."),{})}let QE=0;const Wd=new q;class Yn extends Er{constructor(t=Yn.DEFAULT_IMAGE,e=Yn.DEFAULT_MAPPING,a=qa,o=qa,l=ei,u=vr,h=ta,d=Di,p=Yn.DEFAULT_ANISOTROPY,g=Ps){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:QE++}),this.uuid=Ka(),this.name="",this.source=new qm(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=a,this.wrapT=o,this.magFilter=l,this.minFilter=u,this.anisotropy=p,this.format=h,this.internalFormat=null,this.type=d,this.offset=new Ut(0,0),this.repeat=new Ut(1,1),this.center=new Ut(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Se,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=g,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Wd).x}get height(){return this.source.getSize(Wd).y}get depth(){return this.source.getSize(Wd).z}get image(){return this.source.data}set image(t){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.normalized=t.normalized,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.renderTarget=t.renderTarget,this.isRenderTargetTexture=t.isRenderTargetTexture,this.isArrayTexture=t.isArrayTexture,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}setValues(t){for(const e in t){const a=t[e];if(a===void 0){ge(`Texture.setValues(): parameter '${e}' has value of undefined.`);continue}const o=this[e];if(o===void 0){ge(`Texture.setValues(): property '${e}' does not exist.`);continue}o&&a&&o.isVector2&&a.isVector2||o&&a&&o.isVector3&&a.isVector3||o&&a&&o.isMatrix3&&a.isMatrix3?o.copy(a):this[e]=a}}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const a={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(a.userData=this.userData),e||(t.textures[this.uuid]=a),a}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==zy)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Fo:t.x=t.x-Math.floor(t.x);break;case qa:t.x=t.x<0?0:1;break;case Bp:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Fo:t.y=t.y-Math.floor(t.y);break;case qa:t.y=t.y<0?0:1;break;case Bp:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}}Yn.DEFAULT_IMAGE=null;Yn.DEFAULT_MAPPING=zy;Yn.DEFAULT_ANISOTROPY=1;const fg=class fg{constructor(t=0,e=0,a=0,o=1){this.x=t,this.y=e,this.z=a,this.w=o}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,a,o){return this.x=t,this.y=e,this.z=a,this.w=o,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("THREE.Vector4: index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("THREE.Vector4: index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,a=this.y,o=this.z,l=this.w,u=t.elements;return this.x=u[0]*e+u[4]*a+u[8]*o+u[12]*l,this.y=u[1]*e+u[5]*a+u[9]*o+u[13]*l,this.z=u[2]*e+u[6]*a+u[10]*o+u[14]*l,this.w=u[3]*e+u[7]*a+u[11]*o+u[15]*l,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,a,o,l;const d=t.elements,p=d[0],g=d[4],_=d[8],v=d[1],x=d[5],b=d[9],C=d[2],M=d[6],y=d[10];if(Math.abs(g-v)<.01&&Math.abs(_-C)<.01&&Math.abs(b-M)<.01){if(Math.abs(g+v)<.1&&Math.abs(_+C)<.1&&Math.abs(b+M)<.1&&Math.abs(p+x+y-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const D=(p+1)/2,A=(x+1)/2,O=(y+1)/2,U=(g+v)/4,z=(_+C)/4,T=(b+M)/4;return D>A&&D>O?D<.01?(a=0,o=.707106781,l=.707106781):(a=Math.sqrt(D),o=U/a,l=z/a):A>O?A<.01?(a=.707106781,o=0,l=.707106781):(o=Math.sqrt(A),a=U/o,l=T/o):O<.01?(a=.707106781,o=.707106781,l=0):(l=Math.sqrt(O),a=z/l,o=T/l),this.set(a,o,l,e),this}let I=Math.sqrt((M-b)*(M-b)+(_-C)*(_-C)+(v-g)*(v-g));return Math.abs(I)<.001&&(I=1),this.x=(M-b)/I,this.y=(_-C)/I,this.z=(v-g)/I,this.w=Math.acos((p+x+y-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Ue(this.x,t.x,e.x),this.y=Ue(this.y,t.y,e.y),this.z=Ue(this.z,t.z,e.z),this.w=Ue(this.w,t.w,e.w),this}clampScalar(t,e){return this.x=Ue(this.x,t,e),this.y=Ue(this.y,t,e),this.z=Ue(this.z,t,e),this.w=Ue(this.w,t,e),this}clampLength(t,e){const a=this.length();return this.divideScalar(a||1).multiplyScalar(Ue(a,t,e))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,a){return this.x=t.x+(e.x-t.x)*a,this.y=t.y+(e.y-t.y)*a,this.z=t.z+(e.z-t.z)*a,this.w=t.w+(e.w-t.w)*a,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}};fg.prototype.isVector4=!0;let pn=fg;class $E extends Er{constructor(t=1,e=1,a={}){super(),a=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:ei,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},a),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=a.depth,this.scissor=new pn(0,0,t,e),this.scissorTest=!1,this.viewport=new pn(0,0,t,e),this.textures=[];const o={width:t,height:e,depth:a.depth},l=new Yn(o),u=a.count;for(let h=0;h<u;h++)this.textures[h]=l.clone(),this.textures[h].isRenderTargetTexture=!0,this.textures[h].renderTarget=this;this._setTextureOptions(a),this.depthBuffer=a.depthBuffer,this.stencilBuffer=a.stencilBuffer,this.resolveDepthBuffer=a.resolveDepthBuffer,this.resolveStencilBuffer=a.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=a.depthTexture,this.samples=a.samples,this.multiview=a.multiview,this.useArrayDepthTexture=a.useArrayDepthTexture}_setTextureOptions(t={}){const e={minFilter:ei,generateMipmaps:!1,flipY:!1,internalFormat:null};t.mapping!==void 0&&(e.mapping=t.mapping),t.wrapS!==void 0&&(e.wrapS=t.wrapS),t.wrapT!==void 0&&(e.wrapT=t.wrapT),t.wrapR!==void 0&&(e.wrapR=t.wrapR),t.magFilter!==void 0&&(e.magFilter=t.magFilter),t.minFilter!==void 0&&(e.minFilter=t.minFilter),t.format!==void 0&&(e.format=t.format),t.type!==void 0&&(e.type=t.type),t.anisotropy!==void 0&&(e.anisotropy=t.anisotropy),t.colorSpace!==void 0&&(e.colorSpace=t.colorSpace),t.flipY!==void 0&&(e.flipY=t.flipY),t.generateMipmaps!==void 0&&(e.generateMipmaps=t.generateMipmaps),t.internalFormat!==void 0&&(e.internalFormat=t.internalFormat);for(let a=0;a<this.textures.length;a++)this.textures[a].setValues(e)}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}set depthTexture(t){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),t!==null&&(t.renderTarget=this),this._depthTexture=t}get depthTexture(){return this._depthTexture}setSize(t,e,a=1){if(this.width!==t||this.height!==e||this.depth!==a){this.width=t,this.height=e,this.depth=a;for(let o=0,l=this.textures.length;o<l;o++)this.textures[o].image.width=t,this.textures[o].image.height=e,this.textures[o].image.depth=a,this.textures[o].isData3DTexture!==!0&&(this.textures[o].isArrayTexture=this.textures[o].image.depth>1);this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let e=0,a=t.textures.length;e<a;e++){this.textures[e]=t.textures[e].clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;const o=Object.assign({},t.textures[e].image);this.textures[e].source=new qm(o)}return this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this.multiview=t.multiview,this.useArrayDepthTexture=t.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}}class ma extends $E{constructor(t=1,e=1,a={}){super(t,e,a),this.isWebGLRenderTarget=!0}}class qy extends Yn{constructor(t=null,e=1,a=1,o=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:a,depth:o},this.magFilter=qn,this.minFilter=qn,this.wrapR=qa,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}}class jE extends Yn{constructor(t=null,e=1,a=1,o=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:a,depth:o},this.magFilter=qn,this.minFilter=qn,this.wrapR=qa,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}const Mf=class Mf{constructor(t,e,a,o,l,u,h,d,p,g,_,v,x,b,C,M){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,a,o,l,u,h,d,p,g,_,v,x,b,C,M)}set(t,e,a,o,l,u,h,d,p,g,_,v,x,b,C,M){const y=this.elements;return y[0]=t,y[4]=e,y[8]=a,y[12]=o,y[1]=l,y[5]=u,y[9]=h,y[13]=d,y[2]=p,y[6]=g,y[10]=_,y[14]=v,y[3]=x,y[7]=b,y[11]=C,y[15]=M,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Mf().fromArray(this.elements)}copy(t){const e=this.elements,a=t.elements;return e[0]=a[0],e[1]=a[1],e[2]=a[2],e[3]=a[3],e[4]=a[4],e[5]=a[5],e[6]=a[6],e[7]=a[7],e[8]=a[8],e[9]=a[9],e[10]=a[10],e[11]=a[11],e[12]=a[12],e[13]=a[13],e[14]=a[14],e[15]=a[15],this}copyPosition(t){const e=this.elements,a=t.elements;return e[12]=a[12],e[13]=a[13],e[14]=a[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,a){return this.determinantAffine()===0?(t.set(1,0,0),e.set(0,1,0),a.set(0,0,1),this):(t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),a.setFromMatrixColumn(this,2),this)}makeBasis(t,e,a){return this.set(t.x,e.x,a.x,0,t.y,e.y,a.y,0,t.z,e.z,a.z,0,0,0,0,1),this}extractRotation(t){if(t.determinantAffine()===0)return this.identity();const e=this.elements,a=t.elements,o=1/oo.setFromMatrixColumn(t,0).length(),l=1/oo.setFromMatrixColumn(t,1).length(),u=1/oo.setFromMatrixColumn(t,2).length();return e[0]=a[0]*o,e[1]=a[1]*o,e[2]=a[2]*o,e[3]=0,e[4]=a[4]*l,e[5]=a[5]*l,e[6]=a[6]*l,e[7]=0,e[8]=a[8]*u,e[9]=a[9]*u,e[10]=a[10]*u,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,a=t.x,o=t.y,l=t.z,u=Math.cos(a),h=Math.sin(a),d=Math.cos(o),p=Math.sin(o),g=Math.cos(l),_=Math.sin(l);if(t.order==="XYZ"){const v=u*g,x=u*_,b=h*g,C=h*_;e[0]=d*g,e[4]=-d*_,e[8]=p,e[1]=x+b*p,e[5]=v-C*p,e[9]=-h*d,e[2]=C-v*p,e[6]=b+x*p,e[10]=u*d}else if(t.order==="YXZ"){const v=d*g,x=d*_,b=p*g,C=p*_;e[0]=v+C*h,e[4]=b*h-x,e[8]=u*p,e[1]=u*_,e[5]=u*g,e[9]=-h,e[2]=x*h-b,e[6]=C+v*h,e[10]=u*d}else if(t.order==="ZXY"){const v=d*g,x=d*_,b=p*g,C=p*_;e[0]=v-C*h,e[4]=-u*_,e[8]=b+x*h,e[1]=x+b*h,e[5]=u*g,e[9]=C-v*h,e[2]=-u*p,e[6]=h,e[10]=u*d}else if(t.order==="ZYX"){const v=u*g,x=u*_,b=h*g,C=h*_;e[0]=d*g,e[4]=b*p-x,e[8]=v*p+C,e[1]=d*_,e[5]=C*p+v,e[9]=x*p-b,e[2]=-p,e[6]=h*d,e[10]=u*d}else if(t.order==="YZX"){const v=u*d,x=u*p,b=h*d,C=h*p;e[0]=d*g,e[4]=C-v*_,e[8]=b*_+x,e[1]=_,e[5]=u*g,e[9]=-h*g,e[2]=-p*g,e[6]=x*_+b,e[10]=v-C*_}else if(t.order==="XZY"){const v=u*d,x=u*p,b=h*d,C=h*p;e[0]=d*g,e[4]=-_,e[8]=p*g,e[1]=v*_+C,e[5]=u*g,e[9]=x*_-b,e[2]=b*_-x,e[6]=h*g,e[10]=C*_+v}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(t1,t,e1)}lookAt(t,e,a){const o=this.elements;return wi.subVectors(t,e),wi.lengthSq()===0&&(wi.z=1),wi.normalize(),Rs.crossVectors(a,wi),Rs.lengthSq()===0&&(Math.abs(a.z)===1?wi.x+=1e-4:wi.z+=1e-4,wi.normalize(),Rs.crossVectors(a,wi)),Rs.normalize(),wu.crossVectors(wi,Rs),o[0]=Rs.x,o[4]=wu.x,o[8]=wi.x,o[1]=Rs.y,o[5]=wu.y,o[9]=wi.y,o[2]=Rs.z,o[6]=wu.z,o[10]=wi.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const a=t.elements,o=e.elements,l=this.elements,u=a[0],h=a[4],d=a[8],p=a[12],g=a[1],_=a[5],v=a[9],x=a[13],b=a[2],C=a[6],M=a[10],y=a[14],I=a[3],D=a[7],A=a[11],O=a[15],U=o[0],z=o[4],T=o[8],P=o[12],k=o[1],H=o[5],K=o[9],ft=o[13],dt=o[2],J=o[6],F=o[10],N=o[14],V=o[3],nt=o[7],mt=o[11],L=o[15];return l[0]=u*U+h*k+d*dt+p*V,l[4]=u*z+h*H+d*J+p*nt,l[8]=u*T+h*K+d*F+p*mt,l[12]=u*P+h*ft+d*N+p*L,l[1]=g*U+_*k+v*dt+x*V,l[5]=g*z+_*H+v*J+x*nt,l[9]=g*T+_*K+v*F+x*mt,l[13]=g*P+_*ft+v*N+x*L,l[2]=b*U+C*k+M*dt+y*V,l[6]=b*z+C*H+M*J+y*nt,l[10]=b*T+C*K+M*F+y*mt,l[14]=b*P+C*ft+M*N+y*L,l[3]=I*U+D*k+A*dt+O*V,l[7]=I*z+D*H+A*J+O*nt,l[11]=I*T+D*K+A*F+O*mt,l[15]=I*P+D*ft+A*N+O*L,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],a=t[4],o=t[8],l=t[12],u=t[1],h=t[5],d=t[9],p=t[13],g=t[2],_=t[6],v=t[10],x=t[14],b=t[3],C=t[7],M=t[11],y=t[15],I=d*x-p*v,D=h*x-p*_,A=h*v-d*_,O=u*x-p*g,U=u*v-d*g,z=u*_-h*g;return e*(C*I-M*D+y*A)-a*(b*I-M*O+y*U)+o*(b*D-C*O+y*z)-l*(b*A-C*U+M*z)}determinantAffine(){const t=this.elements,e=t[0],a=t[4],o=t[8],l=t[1],u=t[5],h=t[9],d=t[2],p=t[6],g=t[10];return e*(u*g-h*p)-a*(l*g-h*d)+o*(l*p-u*d)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,a){const o=this.elements;return t.isVector3?(o[12]=t.x,o[13]=t.y,o[14]=t.z):(o[12]=t,o[13]=e,o[14]=a),this}invert(){const t=this.elements,e=t[0],a=t[1],o=t[2],l=t[3],u=t[4],h=t[5],d=t[6],p=t[7],g=t[8],_=t[9],v=t[10],x=t[11],b=t[12],C=t[13],M=t[14],y=t[15],I=e*h-a*u,D=e*d-o*u,A=e*p-l*u,O=a*d-o*h,U=a*p-l*h,z=o*p-l*d,T=g*C-_*b,P=g*M-v*b,k=g*y-x*b,H=_*M-v*C,K=_*y-x*C,ft=v*y-x*M,dt=I*ft-D*K+A*H+O*k-U*P+z*T;if(dt===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const J=1/dt;return t[0]=(h*ft-d*K+p*H)*J,t[1]=(o*K-a*ft-l*H)*J,t[2]=(C*z-M*U+y*O)*J,t[3]=(v*U-_*z-x*O)*J,t[4]=(d*k-u*ft-p*P)*J,t[5]=(e*ft-o*k+l*P)*J,t[6]=(M*A-b*z-y*D)*J,t[7]=(g*z-v*A+x*D)*J,t[8]=(u*K-h*k+p*T)*J,t[9]=(a*k-e*K-l*T)*J,t[10]=(b*U-C*A+y*I)*J,t[11]=(_*A-g*U-x*I)*J,t[12]=(h*P-u*H-d*T)*J,t[13]=(e*H-a*P+o*T)*J,t[14]=(C*D-b*O-M*I)*J,t[15]=(g*O-_*D+v*I)*J,this}scale(t){const e=this.elements,a=t.x,o=t.y,l=t.z;return e[0]*=a,e[4]*=o,e[8]*=l,e[1]*=a,e[5]*=o,e[9]*=l,e[2]*=a,e[6]*=o,e[10]*=l,e[3]*=a,e[7]*=o,e[11]*=l,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],a=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],o=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,a,o))}makeTranslation(t,e,a){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,a,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),a=Math.sin(t);return this.set(1,0,0,0,0,e,-a,0,0,a,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),a=Math.sin(t);return this.set(e,0,a,0,0,1,0,0,-a,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),a=Math.sin(t);return this.set(e,-a,0,0,a,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const a=Math.cos(e),o=Math.sin(e),l=1-a,u=t.x,h=t.y,d=t.z,p=l*u,g=l*h;return this.set(p*u+a,p*h-o*d,p*d+o*h,0,p*h+o*d,g*h+a,g*d-o*u,0,p*d-o*h,g*d+o*u,l*d*d+a,0,0,0,0,1),this}makeScale(t,e,a){return this.set(t,0,0,0,0,e,0,0,0,0,a,0,0,0,0,1),this}makeShear(t,e,a,o,l,u){return this.set(1,a,l,0,t,1,u,0,e,o,1,0,0,0,0,1),this}compose(t,e,a){const o=this.elements,l=e._x,u=e._y,h=e._z,d=e._w,p=l+l,g=u+u,_=h+h,v=l*p,x=l*g,b=l*_,C=u*g,M=u*_,y=h*_,I=d*p,D=d*g,A=d*_,O=a.x,U=a.y,z=a.z;return o[0]=(1-(C+y))*O,o[1]=(x+A)*O,o[2]=(b-D)*O,o[3]=0,o[4]=(x-A)*U,o[5]=(1-(v+y))*U,o[6]=(M+I)*U,o[7]=0,o[8]=(b+D)*z,o[9]=(M-I)*z,o[10]=(1-(v+C))*z,o[11]=0,o[12]=t.x,o[13]=t.y,o[14]=t.z,o[15]=1,this}decompose(t,e,a){const o=this.elements;t.x=o[12],t.y=o[13],t.z=o[14];const l=this.determinantAffine();if(l===0)return a.set(1,1,1),e.identity(),this;let u=oo.set(o[0],o[1],o[2]).length();const h=oo.set(o[4],o[5],o[6]).length(),d=oo.set(o[8],o[9],o[10]).length();l<0&&(u=-u),Ki.copy(this);const p=1/u,g=1/h,_=1/d;return Ki.elements[0]*=p,Ki.elements[1]*=p,Ki.elements[2]*=p,Ki.elements[4]*=g,Ki.elements[5]*=g,Ki.elements[6]*=g,Ki.elements[8]*=_,Ki.elements[9]*=_,Ki.elements[10]*=_,e.setFromRotationMatrix(Ki),a.x=u,a.y=h,a.z=d,this}makePerspective(t,e,a,o,l,u,h=da,d=!1){const p=this.elements,g=2*l/(e-t),_=2*l/(a-o),v=(e+t)/(e-t),x=(a+o)/(a-o);let b,C;if(d)b=l/(u-l),C=u*l/(u-l);else if(h===da)b=-(u+l)/(u-l),C=-2*u*l/(u-l);else if(h===lc)b=-u/(u-l),C=-u*l/(u-l);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+h);return p[0]=g,p[4]=0,p[8]=v,p[12]=0,p[1]=0,p[5]=_,p[9]=x,p[13]=0,p[2]=0,p[6]=0,p[10]=b,p[14]=C,p[3]=0,p[7]=0,p[11]=-1,p[15]=0,this}makeOrthographic(t,e,a,o,l,u,h=da,d=!1){const p=this.elements,g=2/(e-t),_=2/(a-o),v=-(e+t)/(e-t),x=-(a+o)/(a-o);let b,C;if(d)b=1/(u-l),C=u/(u-l);else if(h===da)b=-2/(u-l),C=-(u+l)/(u-l);else if(h===lc)b=-1/(u-l),C=-l/(u-l);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+h);return p[0]=g,p[4]=0,p[8]=0,p[12]=v,p[1]=0,p[5]=_,p[9]=0,p[13]=x,p[2]=0,p[6]=0,p[10]=b,p[14]=C,p[3]=0,p[7]=0,p[11]=0,p[15]=1,this}equals(t){const e=this.elements,a=t.elements;for(let o=0;o<16;o++)if(e[o]!==a[o])return!1;return!0}fromArray(t,e=0){for(let a=0;a<16;a++)this.elements[a]=t[a+e];return this}toArray(t=[],e=0){const a=this.elements;return t[e]=a[0],t[e+1]=a[1],t[e+2]=a[2],t[e+3]=a[3],t[e+4]=a[4],t[e+5]=a[5],t[e+6]=a[6],t[e+7]=a[7],t[e+8]=a[8],t[e+9]=a[9],t[e+10]=a[10],t[e+11]=a[11],t[e+12]=a[12],t[e+13]=a[13],t[e+14]=a[14],t[e+15]=a[15],t}};Mf.prototype.isMatrix4=!0;let en=Mf;const oo=new q,Ki=new en,t1=new q(0,0,0),e1=new q(1,1,1),Rs=new q,wu=new q,wi=new q,xx=new en,yx=new Xo;class ts{constructor(t=0,e=0,a=0,o=ts.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=a,this._order=o}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,a,o=this._order){return this._x=t,this._y=e,this._z=a,this._order=o,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,a=!0){const o=t.elements,l=o[0],u=o[4],h=o[8],d=o[1],p=o[5],g=o[9],_=o[2],v=o[6],x=o[10];switch(e){case"XYZ":this._y=Math.asin(Ue(h,-1,1)),Math.abs(h)<.9999999?(this._x=Math.atan2(-g,x),this._z=Math.atan2(-u,l)):(this._x=Math.atan2(v,p),this._z=0);break;case"YXZ":this._x=Math.asin(-Ue(g,-1,1)),Math.abs(g)<.9999999?(this._y=Math.atan2(h,x),this._z=Math.atan2(d,p)):(this._y=Math.atan2(-_,l),this._z=0);break;case"ZXY":this._x=Math.asin(Ue(v,-1,1)),Math.abs(v)<.9999999?(this._y=Math.atan2(-_,x),this._z=Math.atan2(-u,p)):(this._y=0,this._z=Math.atan2(d,l));break;case"ZYX":this._y=Math.asin(-Ue(_,-1,1)),Math.abs(_)<.9999999?(this._x=Math.atan2(v,x),this._z=Math.atan2(d,l)):(this._x=0,this._z=Math.atan2(-u,p));break;case"YZX":this._z=Math.asin(Ue(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(-g,p),this._y=Math.atan2(-_,l)):(this._x=0,this._y=Math.atan2(h,x));break;case"XZY":this._z=Math.asin(-Ue(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(v,p),this._y=Math.atan2(h,l)):(this._x=Math.atan2(-g,x),this._y=0);break;default:ge("Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,a===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,a){return xx.makeRotationFromQuaternion(t),this.setFromRotationMatrix(xx,e,a)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return yx.setFromEuler(this),this.setFromQuaternion(yx,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}ts.DEFAULT_ORDER="XYZ";class Ym{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}}let n1=0;const Sx=new q,lo=new Xo,Ia=new en,Ru=new q,zl=new q,i1=new q,a1=new Xo,Mx=new q(1,0,0),bx=new q(0,1,0),Ex=new q(0,0,1),Tx={type:"added"},s1={type:"removed"},co={type:"childadded",child:null},qd={type:"childremoved",child:null};class Cn extends Er{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:n1++}),this.uuid=Ka(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Cn.DEFAULT_UP.clone();const t=new q,e=new ts,a=new Xo,o=new q(1,1,1);function l(){a.setFromEuler(e,!1)}function u(){e.setFromQuaternion(a,void 0,!1)}e._onChange(l),a._onChange(u),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:a},scale:{configurable:!0,enumerable:!0,value:o},modelViewMatrix:{value:new en},normalMatrix:{value:new Se}}),this.matrix=new en,this.matrixWorld=new en,this.matrixAutoUpdate=Cn.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Cn.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Ym,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return lo.setFromAxisAngle(t,e),this.quaternion.multiply(lo),this}rotateOnWorldAxis(t,e){return lo.setFromAxisAngle(t,e),this.quaternion.premultiply(lo),this}rotateX(t){return this.rotateOnAxis(Mx,t)}rotateY(t){return this.rotateOnAxis(bx,t)}rotateZ(t){return this.rotateOnAxis(Ex,t)}translateOnAxis(t,e){return Sx.copy(t).applyQuaternion(this.quaternion),this.position.add(Sx.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(Mx,t)}translateY(t){return this.translateOnAxis(bx,t)}translateZ(t){return this.translateOnAxis(Ex,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(Ia.copy(this.matrixWorld).invert())}lookAt(t,e,a){t.isVector3?Ru.copy(t):Ru.set(t,e,a);const o=this.parent;this.updateWorldMatrix(!0,!1),zl.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Ia.lookAt(zl,Ru,this.up):Ia.lookAt(Ru,zl,this.up),this.quaternion.setFromRotationMatrix(Ia),o&&(Ia.extractRotation(o.matrixWorld),lo.setFromRotationMatrix(Ia),this.quaternion.premultiply(lo.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(Oe("Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(Tx),co.child=t,this.dispatchEvent(co),co.child=null):Oe("Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let a=0;a<arguments.length;a++)this.remove(arguments[a]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(s1),qd.child=t,this.dispatchEvent(qd),qd.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),Ia.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),Ia.multiply(t.parent.matrixWorld)),t.applyMatrix4(Ia),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(Tx),co.child=t,this.dispatchEvent(co),co.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let a=0,o=this.children.length;a<o;a++){const u=this.children[a].getObjectByProperty(t,e);if(u!==void 0)return u}}getObjectsByProperty(t,e,a=[]){this[t]===e&&a.push(this);const o=this.children;for(let l=0,u=o.length;l<u;l++)o[l].getObjectsByProperty(t,e,a);return a}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(zl,t,i1),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(zl,a1,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let a=0,o=e.length;a<o;a++)e[a].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let a=0,o=e.length;a<o;a++)e[a].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);const t=this.pivot;if(t!==null){const e=t.x,a=t.y,o=t.z,l=this.matrix.elements;l[12]+=e-l[0]*e-l[4]*a-l[8]*o,l[13]+=a-l[1]*e-l[5]*a-l[9]*o,l[14]+=o-l[2]*e-l[6]*a-l[10]*o}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let a=0,o=e.length;a<o;a++)e[a].updateMatrixWorld(t)}updateWorldMatrix(t,e,a=!1){const o=this.parent;if(t===!0&&o!==null&&o.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||a)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,a=!0),e===!0){const l=this.children;for(let u=0,h=l.length;u<h;u++)l[u].updateWorldMatrix(!1,!0,a)}}toJSON(t){const e=t===void 0||typeof t=="string",a={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},a.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const o={};o.uuid=this.uuid,o.type=this.type,this.name!==""&&(o.name=this.name),this.castShadow===!0&&(o.castShadow=!0),this.receiveShadow===!0&&(o.receiveShadow=!0),this.visible===!1&&(o.visible=!1),this.frustumCulled===!1&&(o.frustumCulled=!1),this.renderOrder!==0&&(o.renderOrder=this.renderOrder),this.static!==!1&&(o.static=this.static),Object.keys(this.userData).length>0&&(o.userData=this.userData),o.layers=this.layers.mask,o.matrix=this.matrix.toArray(),o.up=this.up.toArray(),this.pivot!==null&&(o.pivot=this.pivot.toArray()),this.matrixAutoUpdate===!1&&(o.matrixAutoUpdate=!1),this.morphTargetDictionary!==void 0&&(o.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(o.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(o.type="InstancedMesh",o.count=this.count,o.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(o.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(o.type="BatchedMesh",o.perObjectFrustumCulled=this.perObjectFrustumCulled,o.sortObjects=this.sortObjects,o.drawRanges=this._drawRanges,o.reservedRanges=this._reservedRanges,o.geometryInfo=this._geometryInfo.map(h=>({...h,boundingBox:h.boundingBox?h.boundingBox.toJSON():void 0,boundingSphere:h.boundingSphere?h.boundingSphere.toJSON():void 0})),o.instanceInfo=this._instanceInfo.map(h=>({...h})),o.availableInstanceIds=this._availableInstanceIds.slice(),o.availableGeometryIds=this._availableGeometryIds.slice(),o.nextIndexStart=this._nextIndexStart,o.nextVertexStart=this._nextVertexStart,o.geometryCount=this._geometryCount,o.maxInstanceCount=this._maxInstanceCount,o.maxVertexCount=this._maxVertexCount,o.maxIndexCount=this._maxIndexCount,o.geometryInitialized=this._geometryInitialized,o.matricesTexture=this._matricesTexture.toJSON(t),o.indirectTexture=this._indirectTexture.toJSON(t),this._colorsTexture!==null&&(o.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(o.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(o.boundingBox=this.boundingBox.toJSON()));function l(h,d){return h[d.uuid]===void 0&&(h[d.uuid]=d.toJSON(t)),d.uuid}if(this.isScene)this.background&&(this.background.isColor?o.background=this.background.toJSON():this.background.isTexture&&(o.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(o.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){o.geometry=l(t.geometries,this.geometry);const h=this.geometry.parameters;if(h!==void 0&&h.shapes!==void 0){const d=h.shapes;if(Array.isArray(d))for(let p=0,g=d.length;p<g;p++){const _=d[p];l(t.shapes,_)}else l(t.shapes,d)}}if(this.isSkinnedMesh&&(o.bindMode=this.bindMode,o.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(l(t.skeletons,this.skeleton),o.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const h=[];for(let d=0,p=this.material.length;d<p;d++)h.push(l(t.materials,this.material[d]));o.material=h}else o.material=l(t.materials,this.material);if(this.children.length>0){o.children=[];for(let h=0;h<this.children.length;h++)o.children.push(this.children[h].toJSON(t).object)}if(this.animations.length>0){o.animations=[];for(let h=0;h<this.animations.length;h++){const d=this.animations[h];o.animations.push(l(t.animations,d))}}if(e){const h=u(t.geometries),d=u(t.materials),p=u(t.textures),g=u(t.images),_=u(t.shapes),v=u(t.skeletons),x=u(t.animations),b=u(t.nodes);h.length>0&&(a.geometries=h),d.length>0&&(a.materials=d),p.length>0&&(a.textures=p),g.length>0&&(a.images=g),_.length>0&&(a.shapes=_),v.length>0&&(a.skeletons=v),x.length>0&&(a.animations=x),b.length>0&&(a.nodes=b)}return a.object=o,a;function u(h){const d=[];for(const p in h){const g=h[p];delete g.metadata,d.push(g)}return d}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.pivot=t.pivot!==null?t.pivot.clone():null,this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.static=t.static,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let a=0;a<t.children.length;a++){const o=t.children[a];this.add(o.clone())}return this}}Cn.DEFAULT_UP=new q(0,1,0);Cn.DEFAULT_MATRIX_AUTO_UPDATE=!0;Cn.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;class Xa extends Cn{constructor(){super(),this.isGroup=!0,this.type="Group"}}const r1={type:"move"};class Yd{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Xa,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Xa,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new q,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new q),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Xa,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new q,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new q,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){const e=this._hand;if(e)for(const a of t.hand.values())this._getHandJoint(e,a)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,a){let o=null,l=null,u=null;const h=this._targetRay,d=this._grip,p=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(p&&t.hand){u=!0;for(const C of t.hand.values()){const M=e.getJointPose(C,a),y=this._getHandJoint(p,C);M!==null&&(y.matrix.fromArray(M.transform.matrix),y.matrix.decompose(y.position,y.rotation,y.scale),y.matrixWorldNeedsUpdate=!0,y.jointRadius=M.radius),y.visible=M!==null}const g=p.joints["index-finger-tip"],_=p.joints["thumb-tip"],v=g.position.distanceTo(_.position),x=.02,b=.005;p.inputState.pinching&&v>x+b?(p.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!p.inputState.pinching&&v<=x-b&&(p.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else d!==null&&t.gripSpace&&(l=e.getPose(t.gripSpace,a),l!==null&&(d.matrix.fromArray(l.transform.matrix),d.matrix.decompose(d.position,d.rotation,d.scale),d.matrixWorldNeedsUpdate=!0,l.linearVelocity?(d.hasLinearVelocity=!0,d.linearVelocity.copy(l.linearVelocity)):d.hasLinearVelocity=!1,l.angularVelocity?(d.hasAngularVelocity=!0,d.angularVelocity.copy(l.angularVelocity)):d.hasAngularVelocity=!1,d.eventsEnabled&&d.dispatchEvent({type:"gripUpdated",data:t,target:this})));h!==null&&(o=e.getPose(t.targetRaySpace,a),o===null&&l!==null&&(o=l),o!==null&&(h.matrix.fromArray(o.transform.matrix),h.matrix.decompose(h.position,h.rotation,h.scale),h.matrixWorldNeedsUpdate=!0,o.linearVelocity?(h.hasLinearVelocity=!0,h.linearVelocity.copy(o.linearVelocity)):h.hasLinearVelocity=!1,o.angularVelocity?(h.hasAngularVelocity=!0,h.angularVelocity.copy(o.angularVelocity)):h.hasAngularVelocity=!1,this.dispatchEvent(r1)))}return h!==null&&(h.visible=o!==null),d!==null&&(d.visible=l!==null),p!==null&&(p.visible=u!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){const a=new Xa;a.matrixAutoUpdate=!1,a.visible=!1,t.joints[e.jointName]=a,t.add(a)}return t.joints[e.jointName]}}const Yy={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Cs={h:0,s:0,l:0},Cu={h:0,s:0,l:0};function Zd(s,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?s+(t-s)*6*e:e<1/2?t:e<2/3?s+(t-s)*6*(2/3-e):s}class pe{constructor(t,e,a){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,a)}set(t,e,a){if(e===void 0&&a===void 0){const o=t;o&&o.isColor?this.copy(o):typeof o=="number"?this.setHex(o):typeof o=="string"&&this.setStyle(o)}else this.setRGB(t,e,a);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=Xn){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,Ie.colorSpaceToWorking(this,e),this}setRGB(t,e,a,o=Ie.workingColorSpace){return this.r=t,this.g=e,this.b=a,Ie.colorSpaceToWorking(this,o),this}setHSL(t,e,a,o=Ie.workingColorSpace){if(t=YE(t,1),e=Ue(e,0,1),a=Ue(a,0,1),e===0)this.r=this.g=this.b=a;else{const l=a<=.5?a*(1+e):a+e-a*e,u=2*a-l;this.r=Zd(u,l,t+1/3),this.g=Zd(u,l,t),this.b=Zd(u,l,t-1/3)}return Ie.colorSpaceToWorking(this,o),this}setStyle(t,e=Xn){function a(l){l!==void 0&&parseFloat(l)<1&&ge("Color: Alpha component of "+t+" will be ignored.")}let o;if(o=/^(\w+)\(([^\)]*)\)/.exec(t)){let l;const u=o[1],h=o[2];switch(u){case"rgb":case"rgba":if(l=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(h))return a(l[4]),this.setRGB(Math.min(255,parseInt(l[1],10))/255,Math.min(255,parseInt(l[2],10))/255,Math.min(255,parseInt(l[3],10))/255,e);if(l=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(h))return a(l[4]),this.setRGB(Math.min(100,parseInt(l[1],10))/100,Math.min(100,parseInt(l[2],10))/100,Math.min(100,parseInt(l[3],10))/100,e);break;case"hsl":case"hsla":if(l=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(h))return a(l[4]),this.setHSL(parseFloat(l[1])/360,parseFloat(l[2])/100,parseFloat(l[3])/100,e);break;default:ge("Color: Unknown color model "+t)}}else if(o=/^\#([A-Fa-f\d]+)$/.exec(t)){const l=o[1],u=l.length;if(u===3)return this.setRGB(parseInt(l.charAt(0),16)/15,parseInt(l.charAt(1),16)/15,parseInt(l.charAt(2),16)/15,e);if(u===6)return this.setHex(parseInt(l,16),e);ge("Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=Xn){const a=Yy[t.toLowerCase()];return a!==void 0?this.setHex(a,e):ge("Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=Ja(t.r),this.g=Ja(t.g),this.b=Ja(t.b),this}copyLinearToSRGB(t){return this.r=Po(t.r),this.g=Po(t.g),this.b=Po(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=Xn){return Ie.workingToColorSpace(Qn.copy(this),t),Math.round(Ue(Qn.r*255,0,255))*65536+Math.round(Ue(Qn.g*255,0,255))*256+Math.round(Ue(Qn.b*255,0,255))}getHexString(t=Xn){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=Ie.workingColorSpace){Ie.workingToColorSpace(Qn.copy(this),e);const a=Qn.r,o=Qn.g,l=Qn.b,u=Math.max(a,o,l),h=Math.min(a,o,l);let d,p;const g=(h+u)/2;if(h===u)d=0,p=0;else{const _=u-h;switch(p=g<=.5?_/(u+h):_/(2-u-h),u){case a:d=(o-l)/_+(o<l?6:0);break;case o:d=(l-a)/_+2;break;case l:d=(a-o)/_+4;break}d/=6}return t.h=d,t.s=p,t.l=g,t}getRGB(t,e=Ie.workingColorSpace){return Ie.workingToColorSpace(Qn.copy(this),e),t.r=Qn.r,t.g=Qn.g,t.b=Qn.b,t}getStyle(t=Xn){Ie.workingToColorSpace(Qn.copy(this),t);const e=Qn.r,a=Qn.g,o=Qn.b;return t!==Xn?`color(${t} ${e.toFixed(3)} ${a.toFixed(3)} ${o.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(a*255)},${Math.round(o*255)})`}offsetHSL(t,e,a){return this.getHSL(Cs),this.setHSL(Cs.h+t,Cs.s+e,Cs.l+a)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,a){return this.r=t.r+(e.r-t.r)*a,this.g=t.g+(e.g-t.g)*a,this.b=t.b+(e.b-t.b)*a,this}lerpHSL(t,e){this.getHSL(Cs),t.getHSL(Cu);const a=Gd(Cs.h,Cu.h,e),o=Gd(Cs.s,Cu.s,e),l=Gd(Cs.l,Cu.l,e);return this.setHSL(a,o,l),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,a=this.g,o=this.b,l=t.elements;return this.r=l[0]*e+l[3]*a+l[6]*o,this.g=l[1]*e+l[4]*a+l[7]*o,this.b=l[2]*e+l[5]*a+l[8]*o,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Qn=new pe;pe.NAMES=Yy;class Zm{constructor(t,e=25e-5){this.isFogExp2=!0,this.name="",this.color=new pe(t),this.density=e}clone(){return new Zm(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class Zy extends Cn{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new ts,this.environmentIntensity=1,this.environmentRotation=new ts,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}}const Ji=new q,za=new q,Kd=new q,Fa=new q,uo=new q,fo=new q,Ax=new q,Jd=new q,Qd=new q,$d=new q,jd=new pn,tp=new pn,ep=new pn;class Gi{constructor(t=new q,e=new q,a=new q){this.a=t,this.b=e,this.c=a}static getNormal(t,e,a,o){o.subVectors(a,e),Ji.subVectors(t,e),o.cross(Ji);const l=o.lengthSq();return l>0?o.multiplyScalar(1/Math.sqrt(l)):o.set(0,0,0)}static getBarycoord(t,e,a,o,l){Ji.subVectors(o,e),za.subVectors(a,e),Kd.subVectors(t,e);const u=Ji.dot(Ji),h=Ji.dot(za),d=Ji.dot(Kd),p=za.dot(za),g=za.dot(Kd),_=u*p-h*h;if(_===0)return l.set(0,0,0),null;const v=1/_,x=(p*d-h*g)*v,b=(u*g-h*d)*v;return l.set(1-x-b,b,x)}static containsPoint(t,e,a,o){return this.getBarycoord(t,e,a,o,Fa)===null?!1:Fa.x>=0&&Fa.y>=0&&Fa.x+Fa.y<=1}static getInterpolation(t,e,a,o,l,u,h,d){return this.getBarycoord(t,e,a,o,Fa)===null?(d.x=0,d.y=0,"z"in d&&(d.z=0),"w"in d&&(d.w=0),null):(d.setScalar(0),d.addScaledVector(l,Fa.x),d.addScaledVector(u,Fa.y),d.addScaledVector(h,Fa.z),d)}static getInterpolatedAttribute(t,e,a,o,l,u){return jd.setScalar(0),tp.setScalar(0),ep.setScalar(0),jd.fromBufferAttribute(t,e),tp.fromBufferAttribute(t,a),ep.fromBufferAttribute(t,o),u.setScalar(0),u.addScaledVector(jd,l.x),u.addScaledVector(tp,l.y),u.addScaledVector(ep,l.z),u}static isFrontFacing(t,e,a,o){return Ji.subVectors(a,e),za.subVectors(t,e),Ji.cross(za).dot(o)<0}set(t,e,a){return this.a.copy(t),this.b.copy(e),this.c.copy(a),this}setFromPointsAndIndices(t,e,a,o){return this.a.copy(t[e]),this.b.copy(t[a]),this.c.copy(t[o]),this}setFromAttributeAndIndices(t,e,a,o){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,a),this.c.fromBufferAttribute(t,o),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Ji.subVectors(this.c,this.b),za.subVectors(this.a,this.b),Ji.cross(za).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return Gi.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return Gi.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,a,o,l){return Gi.getInterpolation(t,this.a,this.b,this.c,e,a,o,l)}containsPoint(t){return Gi.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return Gi.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const a=this.a,o=this.b,l=this.c;let u,h;uo.subVectors(o,a),fo.subVectors(l,a),Jd.subVectors(t,a);const d=uo.dot(Jd),p=fo.dot(Jd);if(d<=0&&p<=0)return e.copy(a);Qd.subVectors(t,o);const g=uo.dot(Qd),_=fo.dot(Qd);if(g>=0&&_<=g)return e.copy(o);const v=d*_-g*p;if(v<=0&&d>=0&&g<=0)return u=d/(d-g),e.copy(a).addScaledVector(uo,u);$d.subVectors(t,l);const x=uo.dot($d),b=fo.dot($d);if(b>=0&&x<=b)return e.copy(l);const C=x*p-d*b;if(C<=0&&p>=0&&b<=0)return h=p/(p-b),e.copy(a).addScaledVector(fo,h);const M=g*b-x*_;if(M<=0&&_-g>=0&&x-b>=0)return Ax.subVectors(l,o),h=(_-g)/(_-g+(x-b)),e.copy(o).addScaledVector(Ax,h);const y=1/(M+C+v);return u=C*y,h=v*y,e.copy(a).addScaledVector(uo,u).addScaledVector(fo,h)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}}class Tr{constructor(t=new q(1/0,1/0,1/0),e=new q(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,a=t.length;e<a;e+=3)this.expandByPoint(Qi.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,a=t.count;e<a;e++)this.expandByPoint(Qi.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,a=t.length;e<a;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const a=Qi.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(a),this.max.copy(t).add(a),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const a=t.geometry;if(a!==void 0){const l=a.getAttribute("position");if(e===!0&&l!==void 0&&t.isInstancedMesh!==!0)for(let u=0,h=l.count;u<h;u++)t.isMesh===!0?t.getVertexPosition(u,Qi):Qi.fromBufferAttribute(l,u),Qi.applyMatrix4(t.matrixWorld),this.expandByPoint(Qi);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),Du.copy(t.boundingBox)):(a.boundingBox===null&&a.computeBoundingBox(),Du.copy(a.boundingBox)),Du.applyMatrix4(t.matrixWorld),this.union(Du)}const o=t.children;for(let l=0,u=o.length;l<u;l++)this.expandByObject(o[l],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Qi),Qi.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,a;return t.normal.x>0?(e=t.normal.x*this.min.x,a=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,a=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,a+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,a+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,a+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,a+=t.normal.z*this.min.z),e<=-t.constant&&a>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Fl),Uu.subVectors(this.max,Fl),ho.subVectors(t.a,Fl),po.subVectors(t.b,Fl),mo.subVectors(t.c,Fl),Ds.subVectors(po,ho),Us.subVectors(mo,po),lr.subVectors(ho,mo);let e=[0,-Ds.z,Ds.y,0,-Us.z,Us.y,0,-lr.z,lr.y,Ds.z,0,-Ds.x,Us.z,0,-Us.x,lr.z,0,-lr.x,-Ds.y,Ds.x,0,-Us.y,Us.x,0,-lr.y,lr.x,0];return!np(e,ho,po,mo,Uu)||(e=[1,0,0,0,1,0,0,0,1],!np(e,ho,po,mo,Uu))?!1:(Lu.crossVectors(Ds,Us),e=[Lu.x,Lu.y,Lu.z],np(e,ho,po,mo,Uu))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Qi).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Qi).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(Ha[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),Ha[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),Ha[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),Ha[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),Ha[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),Ha[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),Ha[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),Ha[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(Ha),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(t){return this.min.fromArray(t.min),this.max.fromArray(t.max),this}}const Ha=[new q,new q,new q,new q,new q,new q,new q,new q],Qi=new q,Du=new Tr,ho=new q,po=new q,mo=new q,Ds=new q,Us=new q,lr=new q,Fl=new q,Uu=new q,Lu=new q,cr=new q;function np(s,t,e,a,o){for(let l=0,u=s.length-3;l<=u;l+=3){cr.fromArray(s,l);const h=o.x*Math.abs(cr.x)+o.y*Math.abs(cr.y)+o.z*Math.abs(cr.z),d=t.dot(cr),p=e.dot(cr),g=a.dot(cr);if(Math.max(-Math.max(d,p,g),Math.min(d,p,g))>h)return!1}return!0}const Rn=new q,Nu=new Ut;let o1=0;class ki extends Er{constructor(t,e,a=!1){if(super(),Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:o1++}),this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=a,this.usage=dm,this.updateRanges=[],this.gpuType=ji,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,a){t*=this.itemSize,a*=e.itemSize;for(let o=0,l=this.itemSize;o<l;o++)this.array[t+o]=e.array[a+o];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,a=this.count;e<a;e++)Nu.fromBufferAttribute(this,e),Nu.applyMatrix3(t),this.setXY(e,Nu.x,Nu.y);else if(this.itemSize===3)for(let e=0,a=this.count;e<a;e++)Rn.fromBufferAttribute(this,e),Rn.applyMatrix3(t),this.setXYZ(e,Rn.x,Rn.y,Rn.z);return this}applyMatrix4(t){for(let e=0,a=this.count;e<a;e++)Rn.fromBufferAttribute(this,e),Rn.applyMatrix4(t),this.setXYZ(e,Rn.x,Rn.y,Rn.z);return this}applyNormalMatrix(t){for(let e=0,a=this.count;e<a;e++)Rn.fromBufferAttribute(this,e),Rn.applyNormalMatrix(t),this.setXYZ(e,Rn.x,Rn.y,Rn.z);return this}transformDirection(t){for(let e=0,a=this.count;e<a;e++)Rn.fromBufferAttribute(this,e),Rn.transformDirection(t),this.setXYZ(e,Rn.x,Rn.y,Rn.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let a=this.array[t*this.itemSize+e];return this.normalized&&(a=fa(a,this.array)),a}setComponent(t,e,a){return this.normalized&&(a=tn(a,this.array)),this.array[t*this.itemSize+e]=a,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=fa(e,this.array)),e}setX(t,e){return this.normalized&&(e=tn(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=fa(e,this.array)),e}setY(t,e){return this.normalized&&(e=tn(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=fa(e,this.array)),e}setZ(t,e){return this.normalized&&(e=tn(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=fa(e,this.array)),e}setW(t,e){return this.normalized&&(e=tn(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,a){return t*=this.itemSize,this.normalized&&(e=tn(e,this.array),a=tn(a,this.array)),this.array[t+0]=e,this.array[t+1]=a,this}setXYZ(t,e,a,o){return t*=this.itemSize,this.normalized&&(e=tn(e,this.array),a=tn(a,this.array),o=tn(o,this.array)),this.array[t+0]=e,this.array[t+1]=a,this.array[t+2]=o,this}setXYZW(t,e,a,o,l){return t*=this.itemSize,this.normalized&&(e=tn(e,this.array),a=tn(a,this.array),o=tn(o,this.array),l=tn(l,this.array)),this.array[t+0]=e,this.array[t+1]=a,this.array[t+2]=o,this.array[t+3]=l,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==dm&&(t.usage=this.usage),t}dispose(){this.dispatchEvent({type:"dispose"})}}class Ky extends ki{constructor(t,e,a){super(new Uint16Array(t),e,a)}}class Jy extends ki{constructor(t,e,a){super(new Uint32Array(t),e,a)}}class gn extends ki{constructor(t,e,a){super(new Float32Array(t),e,a)}}const l1=new Tr,Hl=new q,ip=new q;class pc{constructor(t=new q,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const a=this.center;e!==void 0?a.copy(e):l1.setFromPoints(t).getCenter(a);let o=0;for(let l=0,u=t.length;l<u;l++)o=Math.max(o,a.distanceToSquared(t[l]));return this.radius=Math.sqrt(o),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const a=this.center.distanceToSquared(t);return e.copy(t),a>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;Hl.subVectors(t,this.center);const e=Hl.lengthSq();if(e>this.radius*this.radius){const a=Math.sqrt(e),o=(a-this.radius)*.5;this.center.addScaledVector(Hl,o/a),this.radius+=o}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(ip.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(Hl.copy(t.center).add(ip)),this.expandByPoint(Hl.copy(t.center).sub(ip))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(t){return this.radius=t.radius,this.center.fromArray(t.center),this}}let c1=0;const Hi=new en,ap=new Cn,go=new q,Ri=new Tr,Gl=new Tr,Bn=new q;class li extends Er{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:c1++}),this.uuid=Ka(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(kE(t)?Jy:Ky)(t,1):this.index=t,this}setIndirect(t,e=0){return this.indirect=t,this.indirectOffset=e,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,a=0){this.groups.push({start:t,count:e,materialIndex:a})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const a=this.attributes.normal;if(a!==void 0){const l=new Se().getNormalMatrix(t);a.applyNormalMatrix(l),a.needsUpdate=!0}const o=this.attributes.tangent;return o!==void 0&&(o.transformDirection(t),o.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(t){return Hi.makeRotationFromQuaternion(t),this.applyMatrix4(Hi),this}rotateX(t){return Hi.makeRotationX(t),this.applyMatrix4(Hi),this}rotateY(t){return Hi.makeRotationY(t),this.applyMatrix4(Hi),this}rotateZ(t){return Hi.makeRotationZ(t),this.applyMatrix4(Hi),this}translate(t,e,a){return Hi.makeTranslation(t,e,a),this.applyMatrix4(Hi),this}scale(t,e,a){return Hi.makeScale(t,e,a),this.applyMatrix4(Hi),this}lookAt(t){return ap.lookAt(t),ap.updateMatrix(),this.applyMatrix4(ap.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(go).negate(),this.translate(go.x,go.y,go.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const a=[];for(let o=0,l=t.length;o<l;o++){const u=t[o];a.push(u.x,u.y,u.z||0)}this.setAttribute("position",new gn(a,3))}else{const a=Math.min(t.length,e.count);for(let o=0;o<a;o++){const l=t[o];e.setXYZ(o,l.x,l.y,l.z||0)}t.length>e.count&&ge("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Tr);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Oe("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new q(-1/0,-1/0,-1/0),new q(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let a=0,o=e.length;a<o;a++){const l=e[a];Ri.setFromBufferAttribute(l),this.morphTargetsRelative?(Bn.addVectors(this.boundingBox.min,Ri.min),this.boundingBox.expandByPoint(Bn),Bn.addVectors(this.boundingBox.max,Ri.max),this.boundingBox.expandByPoint(Bn)):(this.boundingBox.expandByPoint(Ri.min),this.boundingBox.expandByPoint(Ri.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&Oe('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new pc);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){Oe("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new q,1/0);return}if(t){const a=this.boundingSphere.center;if(Ri.setFromBufferAttribute(t),e)for(let l=0,u=e.length;l<u;l++){const h=e[l];Gl.setFromBufferAttribute(h),this.morphTargetsRelative?(Bn.addVectors(Ri.min,Gl.min),Ri.expandByPoint(Bn),Bn.addVectors(Ri.max,Gl.max),Ri.expandByPoint(Bn)):(Ri.expandByPoint(Gl.min),Ri.expandByPoint(Gl.max))}Ri.getCenter(a);let o=0;for(let l=0,u=t.count;l<u;l++)Bn.fromBufferAttribute(t,l),o=Math.max(o,a.distanceToSquared(Bn));if(e)for(let l=0,u=e.length;l<u;l++){const h=e[l],d=this.morphTargetsRelative;for(let p=0,g=h.count;p<g;p++)Bn.fromBufferAttribute(h,p),d&&(go.fromBufferAttribute(t,p),Bn.add(go)),o=Math.max(o,a.distanceToSquared(Bn))}this.boundingSphere.radius=Math.sqrt(o),isNaN(this.boundingSphere.radius)&&Oe('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){Oe("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const a=e.position,o=e.normal,l=e.uv;let u=this.getAttribute("tangent");(u===void 0||u.count!==a.count)&&(u=new ki(new Float32Array(4*a.count),4),this.setAttribute("tangent",u));const h=[],d=[];for(let T=0;T<a.count;T++)h[T]=new q,d[T]=new q;const p=new q,g=new q,_=new q,v=new Ut,x=new Ut,b=new Ut,C=new q,M=new q;function y(T,P,k){p.fromBufferAttribute(a,T),g.fromBufferAttribute(a,P),_.fromBufferAttribute(a,k),v.fromBufferAttribute(l,T),x.fromBufferAttribute(l,P),b.fromBufferAttribute(l,k),g.sub(p),_.sub(p),x.sub(v),b.sub(v);const H=1/(x.x*b.y-b.x*x.y);isFinite(H)&&(C.copy(g).multiplyScalar(b.y).addScaledVector(_,-x.y).multiplyScalar(H),M.copy(_).multiplyScalar(x.x).addScaledVector(g,-b.x).multiplyScalar(H),h[T].add(C),h[P].add(C),h[k].add(C),d[T].add(M),d[P].add(M),d[k].add(M))}let I=this.groups;I.length===0&&(I=[{start:0,count:t.count}]);for(let T=0,P=I.length;T<P;++T){const k=I[T],H=k.start,K=k.count;for(let ft=H,dt=H+K;ft<dt;ft+=3)y(t.getX(ft+0),t.getX(ft+1),t.getX(ft+2))}const D=new q,A=new q,O=new q,U=new q;function z(T){O.fromBufferAttribute(o,T),U.copy(O);const P=h[T];D.copy(P),D.sub(O.multiplyScalar(O.dot(P))).normalize(),A.crossVectors(U,P);const H=A.dot(d[T])<0?-1:1;u.setXYZW(T,D.x,D.y,D.z,H)}for(let T=0,P=I.length;T<P;++T){const k=I[T],H=k.start,K=k.count;for(let ft=H,dt=H+K;ft<dt;ft+=3)z(t.getX(ft+0)),z(t.getX(ft+1)),z(t.getX(ft+2))}this._transformed=!0}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let a=this.getAttribute("normal");if(a===void 0||a.count!==e.count)a=new ki(new Float32Array(e.count*3),3),this.setAttribute("normal",a);else for(let v=0,x=a.count;v<x;v++)a.setXYZ(v,0,0,0);const o=new q,l=new q,u=new q,h=new q,d=new q,p=new q,g=new q,_=new q;if(t)for(let v=0,x=t.count;v<x;v+=3){const b=t.getX(v+0),C=t.getX(v+1),M=t.getX(v+2);o.fromBufferAttribute(e,b),l.fromBufferAttribute(e,C),u.fromBufferAttribute(e,M),g.subVectors(u,l),_.subVectors(o,l),g.cross(_),h.fromBufferAttribute(a,b),d.fromBufferAttribute(a,C),p.fromBufferAttribute(a,M),h.add(g),d.add(g),p.add(g),a.setXYZ(b,h.x,h.y,h.z),a.setXYZ(C,d.x,d.y,d.z),a.setXYZ(M,p.x,p.y,p.z)}else for(let v=0,x=e.count;v<x;v+=3)o.fromBufferAttribute(e,v+0),l.fromBufferAttribute(e,v+1),u.fromBufferAttribute(e,v+2),g.subVectors(u,l),_.subVectors(o,l),g.cross(_),a.setXYZ(v+0,g.x,g.y,g.z),a.setXYZ(v+1,g.x,g.y,g.z),a.setXYZ(v+2,g.x,g.y,g.z);this.normalizeNormals(),a.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,a=t.count;e<a;e++)Bn.fromBufferAttribute(t,e),Bn.normalize(),t.setXYZ(e,Bn.x,Bn.y,Bn.z)}toNonIndexed(){function t(h,d){const p=h.array,g=h.itemSize,_=h.normalized,v=new p.constructor(d.length*g);let x=0,b=0;for(let C=0,M=d.length;C<M;C++){h.isInterleavedBufferAttribute?x=d[C]*h.data.stride+h.offset:x=d[C]*g;for(let y=0;y<g;y++)v[b++]=p[x++]}return new ki(v,g,_)}if(this.index===null)return ge("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new li,a=this.index.array,o=this.attributes;for(const h in o){const d=o[h],p=t(d,a);e.setAttribute(h,p)}const l=this.morphAttributes;for(const h in l){const d=[],p=l[h];for(let g=0,_=p.length;g<_;g++){const v=p[g],x=t(v,a);d.push(x)}e.morphAttributes[h]=d}e.morphTargetsRelative=this.morphTargetsRelative;const u=this.groups;for(let h=0,d=u.length;h<d;h++){const p=u[h];e.addGroup(p.start,p.count,p.materialIndex)}return e}toJSON(){const t={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){const d=this.parameters;for(const p in d)d[p]!==void 0&&(t[p]=d[p]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const a=this.attributes;for(const d in a){const p=a[d];t.data.attributes[d]=p.toJSON(t.data)}const o={};let l=!1;for(const d in this.morphAttributes){const p=this.morphAttributes[d],g=[];for(let _=0,v=p.length;_<v;_++){const x=p[_];g.push(x.toJSON(t.data))}g.length>0&&(o[d]=g,l=!0)}l&&(t.data.morphAttributes=o,t.data.morphTargetsRelative=this.morphTargetsRelative);const u=this.groups;u.length>0&&(t.data.groups=JSON.parse(JSON.stringify(u)));const h=this.boundingSphere;return h!==null&&(t.data.boundingSphere=h.toJSON()),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const a=t.index;a!==null&&this.setIndex(a.clone());const o=t.attributes;for(const p in o){const g=o[p];this.setAttribute(p,g.clone(e))}const l=t.morphAttributes;for(const p in l){const g=[],_=l[p];for(let v=0,x=_.length;v<x;v++)g.push(_[v].clone(e));this.morphAttributes[p]=g}this.morphTargetsRelative=t.morphTargetsRelative;const u=t.groups;for(let p=0,g=u.length;p<g;p++){const _=u[p];this.addGroup(_.start,_.count,_.materialIndex)}const h=t.boundingBox;h!==null&&(this.boundingBox=h.clone());const d=t.boundingSphere;return d!==null&&(this.boundingSphere=d.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this._transformed=t._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}}class u1{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=dm,this.updateRanges=[],this.version=0,this.uuid=Ka()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,a){t*=this.stride,a*=e.stride;for(let o=0,l=this.stride;o<l;o++)this.array[t+o]=e.array[a+o];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Ka()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),a=new this.constructor(e,this.stride);return a.setUsage(this.usage),a}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){return t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=Ka()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const ai=new q;class gf{constructor(t,e,a,o=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=a,this.normalized=o}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,a=this.data.count;e<a;e++)ai.fromBufferAttribute(this,e),ai.applyMatrix4(t),this.setXYZ(e,ai.x,ai.y,ai.z);return this}applyNormalMatrix(t){for(let e=0,a=this.count;e<a;e++)ai.fromBufferAttribute(this,e),ai.applyNormalMatrix(t),this.setXYZ(e,ai.x,ai.y,ai.z);return this}transformDirection(t){for(let e=0,a=this.count;e<a;e++)ai.fromBufferAttribute(this,e),ai.transformDirection(t),this.setXYZ(e,ai.x,ai.y,ai.z);return this}getComponent(t,e){let a=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(a=fa(a,this.array)),a}setComponent(t,e,a){return this.normalized&&(a=tn(a,this.array)),this.data.array[t*this.data.stride+this.offset+e]=a,this}setX(t,e){return this.normalized&&(e=tn(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=tn(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=tn(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=tn(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=fa(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=fa(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=fa(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=fa(e,this.array)),e}setXY(t,e,a){return t=t*this.data.stride+this.offset,this.normalized&&(e=tn(e,this.array),a=tn(a,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=a,this}setXYZ(t,e,a,o){return t=t*this.data.stride+this.offset,this.normalized&&(e=tn(e,this.array),a=tn(a,this.array),o=tn(o,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=a,this.data.array[t+2]=o,this}setXYZW(t,e,a,o,l){return t=t*this.data.stride+this.offset,this.normalized&&(e=tn(e,this.array),a=tn(a,this.array),o=tn(o,this.array),l=tn(l,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=a,this.data.array[t+2]=o,this.data.array[t+3]=l,this}clone(t){if(t===void 0){mf("InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let a=0;a<this.count;a++){const o=a*this.data.stride+this.offset;for(let l=0;l<this.itemSize;l++)e.push(this.data.array[o+l])}return new ki(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new gf(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){mf("InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let a=0;a<this.count;a++){const o=a*this.data.stride+this.offset;for(let l=0;l<this.itemSize;l++)e.push(this.data.array[o+l])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}let f1=0;class Ar extends Er{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:f1++}),this.uuid=Ka(),this.name="",this.type="Material",this.blending=No,this.side=Fs,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=wp,this.blendDst=Rp,this.blendEquation=pr,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new pe(0,0,0),this.blendAlpha=0,this.depthFunc=Io,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=dx,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=so,this.stencilZFail=so,this.stencilZPass=so,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const a=t[e];if(a===void 0){ge(`Material: parameter '${e}' has value of undefined.`);continue}const o=this[e];if(o===void 0){ge(`Material: '${e}' is not a property of THREE.${this.type}.`);continue}o&&o.isColor?o.set(a):o&&o.isVector2&&a&&a.isVector2||o&&o.isEuler&&a&&a.isEuler||o&&o.isVector3&&a&&a.isVector3?o.copy(a):this[e]=a}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const a={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};a.uuid=this.uuid,a.type=this.type,this.name!==""&&(a.name=this.name),this.color&&this.color.isColor&&(a.color=this.color.getHex()),this.roughness!==void 0&&(a.roughness=this.roughness),this.metalness!==void 0&&(a.metalness=this.metalness),this.sheen!==void 0&&(a.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(a.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(a.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(a.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(a.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(a.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(a.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(a.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(a.shininess=this.shininess),this.clearcoat!==void 0&&(a.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(a.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(a.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(a.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(a.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,a.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(a.sheenColorMap=this.sheenColorMap.toJSON(t).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(a.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(t).uuid),this.dispersion!==void 0&&(a.dispersion=this.dispersion),this.iridescence!==void 0&&(a.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(a.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(a.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(a.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(a.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(a.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(a.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(a.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(a.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(a.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(a.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(a.lightMap=this.lightMap.toJSON(t).uuid,a.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(a.aoMap=this.aoMap.toJSON(t).uuid,a.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(a.bumpMap=this.bumpMap.toJSON(t).uuid,a.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(a.normalMap=this.normalMap.toJSON(t).uuid,a.normalMapType=this.normalMapType,a.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(a.displacementMap=this.displacementMap.toJSON(t).uuid,a.displacementScale=this.displacementScale,a.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(a.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(a.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(a.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(a.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(a.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(a.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(a.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(a.combine=this.combine)),this.envMapRotation!==void 0&&(a.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(a.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(a.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(a.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(a.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(a.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(a.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(a.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(a.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(a.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(a.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(a.size=this.size),this.shadowSide!==null&&(a.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(a.sizeAttenuation=this.sizeAttenuation),this.blending!==No&&(a.blending=this.blending),this.side!==Fs&&(a.side=this.side),this.vertexColors===!0&&(a.vertexColors=!0),this.opacity<1&&(a.opacity=this.opacity),this.transparent===!0&&(a.transparent=!0),this.blendSrc!==wp&&(a.blendSrc=this.blendSrc),this.blendDst!==Rp&&(a.blendDst=this.blendDst),this.blendEquation!==pr&&(a.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(a.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(a.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(a.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(a.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(a.blendAlpha=this.blendAlpha),this.depthFunc!==Io&&(a.depthFunc=this.depthFunc),this.depthTest===!1&&(a.depthTest=this.depthTest),this.depthWrite===!1&&(a.depthWrite=this.depthWrite),this.colorWrite===!1&&(a.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(a.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==dx&&(a.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(a.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(a.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==so&&(a.stencilFail=this.stencilFail),this.stencilZFail!==so&&(a.stencilZFail=this.stencilZFail),this.stencilZPass!==so&&(a.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(a.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(a.rotation=this.rotation),this.polygonOffset===!0&&(a.polygonOffset=!0),this.polygonOffsetFactor!==0&&(a.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(a.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(a.linewidth=this.linewidth),this.dashSize!==void 0&&(a.dashSize=this.dashSize),this.gapSize!==void 0&&(a.gapSize=this.gapSize),this.scale!==void 0&&(a.scale=this.scale),this.dithering===!0&&(a.dithering=!0),this.alphaTest>0&&(a.alphaTest=this.alphaTest),this.alphaHash===!0&&(a.alphaHash=!0),this.alphaToCoverage===!0&&(a.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(a.premultipliedAlpha=!0),this.forceSinglePass===!0&&(a.forceSinglePass=!0),this.allowOverride===!1&&(a.allowOverride=!1),this.wireframe===!0&&(a.wireframe=!0),this.wireframeLinewidth>1&&(a.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(a.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(a.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(a.flatShading=!0),this.visible===!1&&(a.visible=!1),this.toneMapped===!1&&(a.toneMapped=!1),this.fog===!1&&(a.fog=!1),Object.keys(this.userData).length>0&&(a.userData=this.userData);function o(l){const u=[];for(const h in l){const d=l[h];delete d.metadata,u.push(d)}return u}if(e){const l=o(t.textures),u=o(t.images);l.length>0&&(a.textures=l),u.length>0&&(a.images=u)}return a}fromJSON(t,e){if(t.uuid!==void 0&&(this.uuid=t.uuid),t.name!==void 0&&(this.name=t.name),t.color!==void 0&&this.color!==void 0&&this.color.setHex(t.color),t.roughness!==void 0&&(this.roughness=t.roughness),t.metalness!==void 0&&(this.metalness=t.metalness),t.sheen!==void 0&&(this.sheen=t.sheen),t.sheenColor!==void 0&&(this.sheenColor=new pe().setHex(t.sheenColor)),t.sheenRoughness!==void 0&&(this.sheenRoughness=t.sheenRoughness),t.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(t.emissive),t.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(t.specular),t.specularIntensity!==void 0&&(this.specularIntensity=t.specularIntensity),t.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(t.specularColor),t.shininess!==void 0&&(this.shininess=t.shininess),t.clearcoat!==void 0&&(this.clearcoat=t.clearcoat),t.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=t.clearcoatRoughness),t.dispersion!==void 0&&(this.dispersion=t.dispersion),t.iridescence!==void 0&&(this.iridescence=t.iridescence),t.iridescenceIOR!==void 0&&(this.iridescenceIOR=t.iridescenceIOR),t.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=t.iridescenceThicknessRange),t.transmission!==void 0&&(this.transmission=t.transmission),t.thickness!==void 0&&(this.thickness=t.thickness),t.attenuationDistance!==void 0&&(this.attenuationDistance=t.attenuationDistance),t.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(t.attenuationColor),t.anisotropy!==void 0&&(this.anisotropy=t.anisotropy),t.anisotropyRotation!==void 0&&(this.anisotropyRotation=t.anisotropyRotation),t.fog!==void 0&&(this.fog=t.fog),t.flatShading!==void 0&&(this.flatShading=t.flatShading),t.blending!==void 0&&(this.blending=t.blending),t.combine!==void 0&&(this.combine=t.combine),t.side!==void 0&&(this.side=t.side),t.shadowSide!==void 0&&(this.shadowSide=t.shadowSide),t.opacity!==void 0&&(this.opacity=t.opacity),t.transparent!==void 0&&(this.transparent=t.transparent),t.alphaTest!==void 0&&(this.alphaTest=t.alphaTest),t.alphaHash!==void 0&&(this.alphaHash=t.alphaHash),t.depthFunc!==void 0&&(this.depthFunc=t.depthFunc),t.depthTest!==void 0&&(this.depthTest=t.depthTest),t.depthWrite!==void 0&&(this.depthWrite=t.depthWrite),t.colorWrite!==void 0&&(this.colorWrite=t.colorWrite),t.blendSrc!==void 0&&(this.blendSrc=t.blendSrc),t.blendDst!==void 0&&(this.blendDst=t.blendDst),t.blendEquation!==void 0&&(this.blendEquation=t.blendEquation),t.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=t.blendSrcAlpha),t.blendDstAlpha!==void 0&&(this.blendDstAlpha=t.blendDstAlpha),t.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=t.blendEquationAlpha),t.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(t.blendColor),t.blendAlpha!==void 0&&(this.blendAlpha=t.blendAlpha),t.stencilWriteMask!==void 0&&(this.stencilWriteMask=t.stencilWriteMask),t.stencilFunc!==void 0&&(this.stencilFunc=t.stencilFunc),t.stencilRef!==void 0&&(this.stencilRef=t.stencilRef),t.stencilFuncMask!==void 0&&(this.stencilFuncMask=t.stencilFuncMask),t.stencilFail!==void 0&&(this.stencilFail=t.stencilFail),t.stencilZFail!==void 0&&(this.stencilZFail=t.stencilZFail),t.stencilZPass!==void 0&&(this.stencilZPass=t.stencilZPass),t.stencilWrite!==void 0&&(this.stencilWrite=t.stencilWrite),t.wireframe!==void 0&&(this.wireframe=t.wireframe),t.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=t.wireframeLinewidth),t.wireframeLinecap!==void 0&&(this.wireframeLinecap=t.wireframeLinecap),t.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=t.wireframeLinejoin),t.rotation!==void 0&&(this.rotation=t.rotation),t.linewidth!==void 0&&(this.linewidth=t.linewidth),t.dashSize!==void 0&&(this.dashSize=t.dashSize),t.gapSize!==void 0&&(this.gapSize=t.gapSize),t.scale!==void 0&&(this.scale=t.scale),t.polygonOffset!==void 0&&(this.polygonOffset=t.polygonOffset),t.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=t.polygonOffsetFactor),t.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=t.polygonOffsetUnits),t.dithering!==void 0&&(this.dithering=t.dithering),t.alphaToCoverage!==void 0&&(this.alphaToCoverage=t.alphaToCoverage),t.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=t.premultipliedAlpha),t.forceSinglePass!==void 0&&(this.forceSinglePass=t.forceSinglePass),t.allowOverride!==void 0&&(this.allowOverride=t.allowOverride),t.visible!==void 0&&(this.visible=t.visible),t.toneMapped!==void 0&&(this.toneMapped=t.toneMapped),t.userData!==void 0&&(this.userData=t.userData),t.vertexColors!==void 0&&(typeof t.vertexColors=="number"?this.vertexColors=t.vertexColors>0:this.vertexColors=t.vertexColors),t.size!==void 0&&(this.size=t.size),t.sizeAttenuation!==void 0&&(this.sizeAttenuation=t.sizeAttenuation),t.map!==void 0&&(this.map=e[t.map]||null),t.matcap!==void 0&&(this.matcap=e[t.matcap]||null),t.alphaMap!==void 0&&(this.alphaMap=e[t.alphaMap]||null),t.bumpMap!==void 0&&(this.bumpMap=e[t.bumpMap]||null),t.bumpScale!==void 0&&(this.bumpScale=t.bumpScale),t.normalMap!==void 0&&(this.normalMap=e[t.normalMap]||null),t.normalMapType!==void 0&&(this.normalMapType=t.normalMapType),t.normalScale!==void 0){let a=t.normalScale;Array.isArray(a)===!1&&(a=[a,a]),this.normalScale=new Ut().fromArray(a)}return t.displacementMap!==void 0&&(this.displacementMap=e[t.displacementMap]||null),t.displacementScale!==void 0&&(this.displacementScale=t.displacementScale),t.displacementBias!==void 0&&(this.displacementBias=t.displacementBias),t.roughnessMap!==void 0&&(this.roughnessMap=e[t.roughnessMap]||null),t.metalnessMap!==void 0&&(this.metalnessMap=e[t.metalnessMap]||null),t.emissiveMap!==void 0&&(this.emissiveMap=e[t.emissiveMap]||null),t.emissiveIntensity!==void 0&&(this.emissiveIntensity=t.emissiveIntensity),t.specularMap!==void 0&&(this.specularMap=e[t.specularMap]||null),t.specularIntensityMap!==void 0&&(this.specularIntensityMap=e[t.specularIntensityMap]||null),t.specularColorMap!==void 0&&(this.specularColorMap=e[t.specularColorMap]||null),t.envMap!==void 0&&(this.envMap=e[t.envMap]||null),t.envMapRotation!==void 0&&this.envMapRotation.fromArray(t.envMapRotation),t.envMapIntensity!==void 0&&(this.envMapIntensity=t.envMapIntensity),t.reflectivity!==void 0&&(this.reflectivity=t.reflectivity),t.refractionRatio!==void 0&&(this.refractionRatio=t.refractionRatio),t.lightMap!==void 0&&(this.lightMap=e[t.lightMap]||null),t.lightMapIntensity!==void 0&&(this.lightMapIntensity=t.lightMapIntensity),t.aoMap!==void 0&&(this.aoMap=e[t.aoMap]||null),t.aoMapIntensity!==void 0&&(this.aoMapIntensity=t.aoMapIntensity),t.gradientMap!==void 0&&(this.gradientMap=e[t.gradientMap]||null),t.clearcoatMap!==void 0&&(this.clearcoatMap=e[t.clearcoatMap]||null),t.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=e[t.clearcoatRoughnessMap]||null),t.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=e[t.clearcoatNormalMap]||null),t.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new Ut().fromArray(t.clearcoatNormalScale)),t.iridescenceMap!==void 0&&(this.iridescenceMap=e[t.iridescenceMap]||null),t.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=e[t.iridescenceThicknessMap]||null),t.transmissionMap!==void 0&&(this.transmissionMap=e[t.transmissionMap]||null),t.thicknessMap!==void 0&&(this.thicknessMap=e[t.thicknessMap]||null),t.anisotropyMap!==void 0&&(this.anisotropyMap=e[t.anisotropyMap]||null),t.sheenColorMap!==void 0&&(this.sheenColorMap=e[t.sheenColorMap]||null),t.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=e[t.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let a=null;if(e!==null){const o=e.length;a=new Array(o);for(let l=0;l!==o;++l)a[l]=e[l].clone()}return this.clippingPlanes=a,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.allowOverride=t.allowOverride,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}}class mm extends Ar{constructor(t){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new pe(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}let vo;const Vl=new q,_o=new q,xo=new q,yo=new Ut,kl=new Ut,Qy=new en,Ou=new q,Xl=new q,Pu=new q,wx=new Ut,sp=new Ut,Rx=new Ut;class Cx extends Cn{constructor(t=new mm){if(super(),this.isSprite=!0,this.type="Sprite",vo===void 0){vo=new li;const e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),a=new u1(e,5);vo.setIndex([0,1,2,0,2,3]),vo.setAttribute("position",new gf(a,3,0,!1)),vo.setAttribute("uv",new gf(a,2,3,!1))}this.geometry=vo,this.material=t,this.center=new Ut(.5,.5),this.count=1}raycast(t,e){t.camera===null&&Oe('Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),_o.setFromMatrixScale(this.matrixWorld),Qy.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),xo.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&_o.multiplyScalar(-xo.z);const a=this.material.rotation;let o,l;a!==0&&(l=Math.cos(a),o=Math.sin(a));const u=this.center;Bu(Ou.set(-.5,-.5,0),xo,u,_o,o,l),Bu(Xl.set(.5,-.5,0),xo,u,_o,o,l),Bu(Pu.set(.5,.5,0),xo,u,_o,o,l),wx.set(0,0),sp.set(1,0),Rx.set(1,1);let h=t.ray.intersectTriangle(Ou,Xl,Pu,!1,Vl);if(h===null&&(Bu(Xl.set(-.5,.5,0),xo,u,_o,o,l),sp.set(0,1),h=t.ray.intersectTriangle(Ou,Pu,Xl,!1,Vl),h===null))return;const d=t.ray.origin.distanceTo(Vl);d<t.near||d>t.far||e.push({distance:d,point:Vl.clone(),uv:Gi.getInterpolation(Vl,Ou,Xl,Pu,wx,sp,Rx,new Ut),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}}function Bu(s,t,e,a,o,l){yo.subVectors(s,e).addScalar(.5).multiply(a),o!==void 0?(kl.x=l*yo.x-o*yo.y,kl.y=o*yo.x+l*yo.y):kl.copy(yo),s.copy(t),s.x+=kl.x,s.y+=kl.y,s.applyMatrix4(Qy)}const Ga=new q,rp=new q,Iu=new q,Ls=new q,op=new q,zu=new q,lp=new q;class $y{constructor(t=new q,e=new q(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,Ga)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const a=e.dot(this.direction);return a<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,a)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=Ga.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(Ga.copy(this.origin).addScaledVector(this.direction,e),Ga.distanceToSquared(t))}distanceSqToSegment(t,e,a,o){rp.copy(t).add(e).multiplyScalar(.5),Iu.copy(e).sub(t).normalize(),Ls.copy(this.origin).sub(rp);const l=t.distanceTo(e)*.5,u=-this.direction.dot(Iu),h=Ls.dot(this.direction),d=-Ls.dot(Iu),p=Ls.lengthSq(),g=Math.abs(1-u*u);let _,v,x,b;if(g>0)if(_=u*d-h,v=u*h-d,b=l*g,_>=0)if(v>=-b)if(v<=b){const C=1/g;_*=C,v*=C,x=_*(_+u*v+2*h)+v*(u*_+v+2*d)+p}else v=l,_=Math.max(0,-(u*v+h)),x=-_*_+v*(v+2*d)+p;else v=-l,_=Math.max(0,-(u*v+h)),x=-_*_+v*(v+2*d)+p;else v<=-b?(_=Math.max(0,-(-u*l+h)),v=_>0?-l:Math.min(Math.max(-l,-d),l),x=-_*_+v*(v+2*d)+p):v<=b?(_=0,v=Math.min(Math.max(-l,-d),l),x=v*(v+2*d)+p):(_=Math.max(0,-(u*l+h)),v=_>0?l:Math.min(Math.max(-l,-d),l),x=-_*_+v*(v+2*d)+p);else v=u>0?-l:l,_=Math.max(0,-(u*v+h)),x=-_*_+v*(v+2*d)+p;return a&&a.copy(this.origin).addScaledVector(this.direction,_),o&&o.copy(rp).addScaledVector(Iu,v),x}intersectSphere(t,e){Ga.subVectors(t.center,this.origin);const a=Ga.dot(this.direction),o=Ga.dot(Ga)-a*a,l=t.radius*t.radius;if(o>l)return null;const u=Math.sqrt(l-o),h=a-u,d=a+u;return d<0?null:h<0?this.at(d,e):this.at(h,e)}intersectsSphere(t){return t.radius<0?!1:this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const a=-(this.origin.dot(t.normal)+t.constant)/e;return a>=0?a:null}intersectPlane(t,e){const a=this.distanceToPlane(t);return a===null?null:this.at(a,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let a,o,l,u,h,d;const p=1/this.direction.x,g=1/this.direction.y,_=1/this.direction.z,v=this.origin;return p>=0?(a=(t.min.x-v.x)*p,o=(t.max.x-v.x)*p):(a=(t.max.x-v.x)*p,o=(t.min.x-v.x)*p),g>=0?(l=(t.min.y-v.y)*g,u=(t.max.y-v.y)*g):(l=(t.max.y-v.y)*g,u=(t.min.y-v.y)*g),a>u||l>o||((l>a||isNaN(a))&&(a=l),(u<o||isNaN(o))&&(o=u),_>=0?(h=(t.min.z-v.z)*_,d=(t.max.z-v.z)*_):(h=(t.max.z-v.z)*_,d=(t.min.z-v.z)*_),a>d||h>o)||((h>a||a!==a)&&(a=h),(d<o||o!==o)&&(o=d),o<0)?null:this.at(a>=0?a:o,e)}intersectsBox(t){return this.intersectBox(t,Ga)!==null}intersectTriangle(t,e,a,o,l){op.subVectors(e,t),zu.subVectors(a,t),lp.crossVectors(op,zu);let u=this.direction.dot(lp),h;if(u>0){if(o)return null;h=1}else if(u<0)h=-1,u=-u;else return null;Ls.subVectors(this.origin,t);const d=h*this.direction.dot(zu.crossVectors(Ls,zu));if(d<0)return null;const p=h*this.direction.dot(op.cross(Ls));if(p<0||d+p>u)return null;const g=-h*Ls.dot(lp);return g<0?null:this.at(g/u,l)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Km extends Ar{constructor(t){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new pe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ts,this.combine=Pm,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}}const Dx=new en,ur=new $y,Fu=new pc,Ux=new q,Hu=new q,Gu=new q,Vu=new q,cp=new q,ku=new q,Lx=new q,Xu=new q;class Ge extends Cn{constructor(t=new li,e=new Km){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,a=Object.keys(e);if(a.length>0){const o=e[a[0]];if(o!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let l=0,u=o.length;l<u;l++){const h=o[l].name||String(l);this.morphTargetInfluences.push(0),this.morphTargetDictionary[h]=l}}}}getVertexPosition(t,e){const a=this.geometry,o=a.attributes.position,l=a.morphAttributes.position,u=a.morphTargetsRelative;e.fromBufferAttribute(o,t);const h=this.morphTargetInfluences;if(l&&h){ku.set(0,0,0);for(let d=0,p=l.length;d<p;d++){const g=h[d],_=l[d];g!==0&&(cp.fromBufferAttribute(_,t),u?ku.addScaledVector(cp,g):ku.addScaledVector(cp.sub(e),g))}e.add(ku)}return e}raycast(t,e){const a=this.geometry,o=this.material,l=this.matrixWorld;o!==void 0&&(a.boundingSphere===null&&a.computeBoundingSphere(),Fu.copy(a.boundingSphere),Fu.applyMatrix4(l),ur.copy(t.ray).recast(t.near),!(Fu.containsPoint(ur.origin)===!1&&(ur.intersectSphere(Fu,Ux)===null||ur.origin.distanceToSquared(Ux)>(t.far-t.near)**2))&&(Dx.copy(l).invert(),ur.copy(t.ray).applyMatrix4(Dx),!(a.boundingBox!==null&&ur.intersectsBox(a.boundingBox)===!1)&&this._computeIntersections(t,e,ur)))}_computeIntersections(t,e,a){let o;const l=this.geometry,u=this.material,h=l.index,d=l.attributes.position,p=l.attributes.uv,g=l.attributes.uv1,_=l.attributes.normal,v=l.groups,x=l.drawRange;if(h!==null)if(Array.isArray(u))for(let b=0,C=v.length;b<C;b++){const M=v[b],y=u[M.materialIndex],I=Math.max(M.start,x.start),D=Math.min(h.count,Math.min(M.start+M.count,x.start+x.count));for(let A=I,O=D;A<O;A+=3){const U=h.getX(A),z=h.getX(A+1),T=h.getX(A+2);o=Wu(this,y,t,a,p,g,_,U,z,T),o&&(o.faceIndex=Math.floor(A/3),o.face.materialIndex=M.materialIndex,e.push(o))}}else{const b=Math.max(0,x.start),C=Math.min(h.count,x.start+x.count);for(let M=b,y=C;M<y;M+=3){const I=h.getX(M),D=h.getX(M+1),A=h.getX(M+2);o=Wu(this,u,t,a,p,g,_,I,D,A),o&&(o.faceIndex=Math.floor(M/3),e.push(o))}}else if(d!==void 0)if(Array.isArray(u))for(let b=0,C=v.length;b<C;b++){const M=v[b],y=u[M.materialIndex],I=Math.max(M.start,x.start),D=Math.min(d.count,Math.min(M.start+M.count,x.start+x.count));for(let A=I,O=D;A<O;A+=3){const U=A,z=A+1,T=A+2;o=Wu(this,y,t,a,p,g,_,U,z,T),o&&(o.faceIndex=Math.floor(A/3),o.face.materialIndex=M.materialIndex,e.push(o))}}else{const b=Math.max(0,x.start),C=Math.min(d.count,x.start+x.count);for(let M=b,y=C;M<y;M+=3){const I=M,D=M+1,A=M+2;o=Wu(this,u,t,a,p,g,_,I,D,A),o&&(o.faceIndex=Math.floor(M/3),e.push(o))}}}}function h1(s,t,e,a,o,l,u,h){let d;if(t.side===ni?d=a.intersectTriangle(u,l,o,!0,h):d=a.intersectTriangle(o,l,u,t.side===Fs,h),d===null)return null;Xu.copy(h),Xu.applyMatrix4(s.matrixWorld);const p=e.ray.origin.distanceTo(Xu);return p<e.near||p>e.far?null:{distance:p,point:Xu.clone(),object:s}}function Wu(s,t,e,a,o,l,u,h,d,p){s.getVertexPosition(h,Hu),s.getVertexPosition(d,Gu),s.getVertexPosition(p,Vu);const g=h1(s,t,e,a,Hu,Gu,Vu,Lx);if(g){const _=new q;Gi.getBarycoord(Lx,Hu,Gu,Vu,_),o&&(g.uv=Gi.getInterpolatedAttribute(o,h,d,p,_,new Ut)),l&&(g.uv1=Gi.getInterpolatedAttribute(l,h,d,p,_,new Ut)),u&&(g.normal=Gi.getInterpolatedAttribute(u,h,d,p,_,new q),g.normal.dot(a.direction)>0&&g.normal.multiplyScalar(-1));const v={a:h,b:d,c:p,normal:new q,materialIndex:0};Gi.getNormal(Hu,Gu,Vu,v.normal),g.face=v,g.barycoord=_}return g}class jy extends Yn{constructor(t=null,e=1,a=1,o,l,u,h,d,p=qn,g=qn,_,v){super(null,u,h,d,p,g,o,l,_,v),this.isDataTexture=!0,this.image={data:t,width:e,height:a},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Nx extends ki{constructor(t,e,a,o=1){super(t,e,a),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=o}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){const t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}}const So=new en,Ox=new en,qu=[],Px=new Tr,d1=new en,Wl=new Ge,ql=new pc;class tS extends Ge{constructor(t,e,a){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new Nx(new Float32Array(a*16),16),this.instanceColor=null,this.morphTexture=null,this.count=a,this.boundingBox=null,this.boundingSphere=null;for(let o=0;o<a;o++)this.setMatrixAt(o,d1)}computeBoundingBox(){const t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new Tr),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let a=0;a<e;a++)this.getMatrixAt(a,So),Px.copy(t.boundingBox).applyMatrix4(So),this.boundingBox.union(Px)}computeBoundingSphere(){const t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new pc),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let a=0;a<e;a++)this.getMatrixAt(a,So),ql.copy(t.boundingSphere).applyMatrix4(So),this.boundingSphere.union(ql)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){return this.instanceColor===null?e.setRGB(1,1,1):e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){return e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){const a=e.morphTargetInfluences,o=this.morphTexture.source.data.data,l=a.length+1,u=t*l+1;for(let h=0;h<a.length;h++)a[h]=o[u+h]}raycast(t,e){const a=this.matrixWorld,o=this.count;if(Wl.geometry=this.geometry,Wl.material=this.material,Wl.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),ql.copy(this.boundingSphere),ql.applyMatrix4(a),t.ray.intersectsSphere(ql)!==!1))for(let l=0;l<o;l++){this.getMatrixAt(l,So),Ox.multiplyMatrices(a,So),Wl.matrixWorld=Ox,Wl.raycast(t,qu);for(let u=0,h=qu.length;u<h;u++){const d=qu[u];d.instanceId=l,d.object=this,e.push(d)}qu.length=0}}setColorAt(t,e){return this.instanceColor===null&&(this.instanceColor=new Nx(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3),this}setMatrixAt(t,e){return e.toArray(this.instanceMatrix.array,t*16),this}setMorphAt(t,e){const a=e.morphTargetInfluences,o=a.length+1;this.morphTexture===null&&(this.morphTexture=new jy(new Float32Array(o*this.count),o,this.count,Hm,ji));const l=this.morphTexture.source.data.data;let u=0;for(let p=0;p<a.length;p++)u+=a[p];const h=this.geometry.morphTargetsRelative?1:1-u,d=o*t;return l[d]=h,l.set(a,d+1),this}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}}const up=new q,p1=new q,m1=new Se;class hr{constructor(t=new q(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,a,o){return this.normal.set(t,e,a),this.constant=o,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,a){const o=up.subVectors(a,e).cross(p1.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(o,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){const t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e,a=!0){const o=t.delta(up),l=this.normal.dot(o);if(l===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;const u=-(t.start.dot(this.normal)+this.constant)/l;return a===!0&&(u<0||u>1)?null:e.copy(t.start).addScaledVector(o,u)}intersectsLine(t){const e=this.distanceToPoint(t.start),a=this.distanceToPoint(t.end);return e<0&&a>0||a<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){const a=e||m1.getNormalMatrix(t),o=this.coplanarPoint(up).applyMatrix4(t),l=this.normal.applyMatrix3(a).normalize();return this.constant=-o.dot(l),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}}const fr=new pc,g1=new Ut(.5,.5),Yu=new q;class Jm{constructor(t=new hr,e=new hr,a=new hr,o=new hr,l=new hr,u=new hr){this.planes=[t,e,a,o,l,u]}set(t,e,a,o,l,u){const h=this.planes;return h[0].copy(t),h[1].copy(e),h[2].copy(a),h[3].copy(o),h[4].copy(l),h[5].copy(u),this}copy(t){const e=this.planes;for(let a=0;a<6;a++)e[a].copy(t.planes[a]);return this}setFromProjectionMatrix(t,e=da,a=!1){const o=this.planes,l=t.elements,u=l[0],h=l[1],d=l[2],p=l[3],g=l[4],_=l[5],v=l[6],x=l[7],b=l[8],C=l[9],M=l[10],y=l[11],I=l[12],D=l[13],A=l[14],O=l[15];if(o[0].setComponents(p-u,x-g,y-b,O-I).normalize(),o[1].setComponents(p+u,x+g,y+b,O+I).normalize(),o[2].setComponents(p+h,x+_,y+C,O+D).normalize(),o[3].setComponents(p-h,x-_,y-C,O-D).normalize(),a)o[4].setComponents(d,v,M,A).normalize(),o[5].setComponents(p-d,x-v,y-M,O-A).normalize();else if(o[4].setComponents(p-d,x-v,y-M,O-A).normalize(),e===da)o[5].setComponents(p+d,x+v,y+M,O+A).normalize();else if(e===lc)o[5].setComponents(d,v,M,A).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),fr.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{const e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),fr.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(fr)}intersectsSprite(t){fr.center.set(0,0,0);const e=g1.distanceTo(t.center);return fr.radius=.7071067811865476+e,fr.applyMatrix4(t.matrixWorld),this.intersectsSphere(fr)}intersectsSphere(t){const e=this.planes,a=t.center,o=-t.radius;for(let l=0;l<6;l++)if(e[l].distanceToPoint(a)<o)return!1;return!0}intersectsBox(t){const e=this.planes;for(let a=0;a<6;a++){const o=e[a];if(Yu.x=o.normal.x>0?t.max.x:t.min.x,Yu.y=o.normal.y>0?t.max.y:t.min.y,Yu.z=o.normal.z>0?t.max.z:t.min.z,o.distanceToPoint(Yu)<0)return!1}return!0}containsPoint(t){const e=this.planes;for(let a=0;a<6;a++)if(e[a].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class eS extends Yn{constructor(t=[],e=yr,a,o,l,u,h,d,p,g){super(t,e,a,o,l,u,h,d,p,g),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}}class vf extends Yn{constructor(t,e,a,o,l,u,h,d,p){super(t,e,a,o,l,u,h,d,p),this.isCanvasTexture=!0,this.needsUpdate=!0}}class Ho extends Yn{constructor(t,e,a=ga,o,l,u,h=qn,d=qn,p,g=ja,_=1){if(g!==ja&&g!==_r)throw new Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");const v={width:t,height:e,depth:_};super(v,o,l,u,h,d,g,a,p),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.source=new qm(Object.assign({},t.image)),this.compareFunction=t.compareFunction,this}toJSON(t){const e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}}class v1 extends Ho{constructor(t,e=ga,a=yr,o,l,u=qn,h=qn,d,p=ja){const g={width:t,height:t,depth:1},_=[g,g,g,g,g,g];super(t,t,e,a,o,l,u,h,d,p),this.image=_,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(t){this.image=t}}class nS extends Yn{constructor(t=null){super(),this.sourceTexture=t,this.isExternalTexture=!0}copy(t){return super.copy(t),this.sourceTexture=t.sourceTexture,this}}class Qa extends li{constructor(t=1,e=1,a=1,o=1,l=1,u=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:a,widthSegments:o,heightSegments:l,depthSegments:u};const h=this;o=Math.floor(o),l=Math.floor(l),u=Math.floor(u);const d=[],p=[],g=[],_=[];let v=0,x=0;b("z","y","x",-1,-1,a,e,t,u,l,0),b("z","y","x",1,-1,a,e,-t,u,l,1),b("x","z","y",1,1,t,a,e,o,u,2),b("x","z","y",1,-1,t,a,-e,o,u,3),b("x","y","z",1,-1,t,e,a,o,l,4),b("x","y","z",-1,-1,t,e,-a,o,l,5),this.setIndex(d),this.setAttribute("position",new gn(p,3)),this.setAttribute("normal",new gn(g,3)),this.setAttribute("uv",new gn(_,2));function b(C,M,y,I,D,A,O,U,z,T,P){const k=A/z,H=O/T,K=A/2,ft=O/2,dt=U/2,J=z+1,F=T+1;let N=0,V=0;const nt=new q;for(let mt=0;mt<F;mt++){const L=mt*H-ft;for(let X=0;X<J;X++){const _t=X*k-K;nt[C]=_t*I,nt[M]=L*D,nt[y]=dt,p.push(nt.x,nt.y,nt.z),nt[C]=0,nt[M]=0,nt[y]=U>0?1:-1,g.push(nt.x,nt.y,nt.z),_.push(X/z),_.push(1-mt/T),N+=1}}for(let mt=0;mt<T;mt++)for(let L=0;L<z;L++){const X=v+L+J*mt,_t=v+L+J*(mt+1),Ct=v+(L+1)+J*(mt+1),Lt=v+(L+1)+J*mt;d.push(X,_t,Lt),d.push(_t,Ct,Lt),V+=6}h.addGroup(x,V,P),x+=V,v+=N}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Qa(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}}class uc extends li{constructor(t=1,e=1,a=1,o=32,l=1,u=!1,h=0,d=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:a,radialSegments:o,heightSegments:l,openEnded:u,thetaStart:h,thetaLength:d};const p=this;o=Math.floor(o),l=Math.floor(l);const g=[],_=[],v=[],x=[];let b=0;const C=[],M=a/2;let y=0;I(),u===!1&&(t>0&&D(!0),e>0&&D(!1)),this.setIndex(g),this.setAttribute("position",new gn(_,3)),this.setAttribute("normal",new gn(v,3)),this.setAttribute("uv",new gn(x,2));function I(){const A=new q,O=new q;let U=0;const z=(e-t)/a;for(let T=0;T<=l;T++){const P=[],k=T/l,H=k*(e-t)+t;for(let K=0;K<=o;K++){const ft=K/o,dt=ft*d+h,J=Math.sin(dt),F=Math.cos(dt);O.x=H*J,O.y=-k*a+M,O.z=H*F,_.push(O.x,O.y,O.z),A.set(J,z,F).normalize(),v.push(A.x,A.y,A.z),x.push(ft,1-k),P.push(b++)}C.push(P)}for(let T=0;T<o;T++)for(let P=0;P<l;P++){const k=C[P][T],H=C[P+1][T],K=C[P+1][T+1],ft=C[P][T+1];(t>0||P!==0)&&(g.push(k,H,ft),U+=3),(e>0||P!==l-1)&&(g.push(H,K,ft),U+=3)}p.addGroup(y,U,0),y+=U}function D(A){const O=b,U=new Ut,z=new q;let T=0;const P=A===!0?t:e,k=A===!0?1:-1;for(let K=1;K<=o;K++)_.push(0,M*k,0),v.push(0,k,0),x.push(.5,.5),b++;const H=b;for(let K=0;K<=o;K++){const dt=K/o*d+h,J=Math.cos(dt),F=Math.sin(dt);z.x=P*F,z.y=M*k,z.z=P*J,_.push(z.x,z.y,z.z),v.push(0,k,0),U.x=J*.5+.5,U.y=F*.5*k+.5,x.push(U.x,U.y),b++}for(let K=0;K<o;K++){const ft=O+K,dt=H+K;A===!0?g.push(dt,dt+1,ft):g.push(dt+1,dt,ft),T+=3}p.addGroup(y,T,A===!0?1:2),y+=T}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new uc(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class _f extends uc{constructor(t=1,e=1,a=32,o=1,l=!1,u=0,h=Math.PI*2){super(0,t,e,a,o,l,u,h),this.type="ConeGeometry",this.parameters={radius:t,height:e,radialSegments:a,heightSegments:o,openEnded:l,thetaStart:u,thetaLength:h}}static fromJSON(t){return new _f(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class va{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){ge("Curve: .getPoint() not implemented.")}getPointAt(t,e){const a=this.getUtoTmapping(t);return this.getPoint(a,e)}getPoints(t=5){const e=[];for(let a=0;a<=t;a++)e.push(this.getPoint(a/t));return e}getSpacedPoints(t=5){const e=[];for(let a=0;a<=t;a++)e.push(this.getPointAt(a/t));return e}getLength(){const t=this.getLengths();return t[t.length-1]}getLengths(t=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===t+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;const e=[];let a,o=this.getPoint(0),l=0;e.push(0);for(let u=1;u<=t;u++)a=this.getPoint(u/t),l+=a.distanceTo(o),e.push(l),o=a;return this.cacheArcLengths=e,e}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(t,e=null){const a=this.getLengths();let o=0;const l=a.length;let u;e?u=e:u=t*a[l-1];let h=0,d=l-1,p;for(;h<=d;)if(o=Math.floor(h+(d-h)/2),p=a[o]-u,p<0)h=o+1;else if(p>0)d=o-1;else{d=o;break}if(o=d,a[o]===u)return o/(l-1);const g=a[o],v=a[o+1]-g,x=(u-g)/v;return(o+x)/(l-1)}getTangent(t,e){let o=t-1e-4,l=t+1e-4;o<0&&(o=0),l>1&&(l=1);const u=this.getPoint(o),h=this.getPoint(l),d=e||(u.isVector2?new Ut:new q);return d.copy(h).sub(u).normalize(),d}getTangentAt(t,e){const a=this.getUtoTmapping(t);return this.getTangent(a,e)}computeFrenetFrames(t,e=!1){const a=new q,o=[],l=[],u=[],h=new q,d=new en;for(let x=0;x<=t;x++){const b=x/t;o[x]=this.getTangentAt(b,new q)}l[0]=new q,u[0]=new q;let p=Number.MAX_VALUE;const g=Math.abs(o[0].x),_=Math.abs(o[0].y),v=Math.abs(o[0].z);g<=p&&(p=g,a.set(1,0,0)),_<=p&&(p=_,a.set(0,1,0)),v<=p&&a.set(0,0,1),h.crossVectors(o[0],a).normalize(),l[0].crossVectors(o[0],h),u[0].crossVectors(o[0],l[0]);for(let x=1;x<=t;x++){if(l[x]=l[x-1].clone(),u[x]=u[x-1].clone(),h.crossVectors(o[x-1],o[x]),h.length()>Number.EPSILON){h.normalize();const b=Math.acos(Ue(o[x-1].dot(o[x]),-1,1));l[x].applyMatrix4(d.makeRotationAxis(h,b))}u[x].crossVectors(o[x],l[x])}if(e===!0){let x=Math.acos(Ue(l[0].dot(l[t]),-1,1));x/=t,o[0].dot(h.crossVectors(l[0],l[t]))>0&&(x=-x);for(let b=1;b<=t;b++)l[b].applyMatrix4(d.makeRotationAxis(o[b],x*b)),u[b].crossVectors(o[b],l[b])}return{tangents:o,normals:l,binormals:u}}clone(){return new this.constructor().copy(this)}copy(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}toJSON(){const t={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return t.arcLengthDivisions=this.arcLengthDivisions,t.type=this.type,t}fromJSON(t){return this.arcLengthDivisions=t.arcLengthDivisions,this}}class Qm extends va{constructor(t=0,e=0,a=1,o=1,l=0,u=Math.PI*2,h=!1,d=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=t,this.aY=e,this.xRadius=a,this.yRadius=o,this.aStartAngle=l,this.aEndAngle=u,this.aClockwise=h,this.aRotation=d}getPoint(t,e=new Ut){const a=e,o=Math.PI*2;let l=this.aEndAngle-this.aStartAngle;const u=Math.abs(l)<Number.EPSILON;for(;l<0;)l+=o;for(;l>o;)l-=o;l<Number.EPSILON&&(u?l=0:l=o),this.aClockwise===!0&&!u&&(l===o?l=-o:l=l-o);const h=this.aStartAngle+t*l;let d=this.aX+this.xRadius*Math.cos(h),p=this.aY+this.yRadius*Math.sin(h);if(this.aRotation!==0){const g=Math.cos(this.aRotation),_=Math.sin(this.aRotation),v=d-this.aX,x=p-this.aY;d=v*g-x*_+this.aX,p=v*_+x*g+this.aY}return a.set(d,p)}copy(t){return super.copy(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}toJSON(){const t=super.toJSON();return t.aX=this.aX,t.aY=this.aY,t.xRadius=this.xRadius,t.yRadius=this.yRadius,t.aStartAngle=this.aStartAngle,t.aEndAngle=this.aEndAngle,t.aClockwise=this.aClockwise,t.aRotation=this.aRotation,t}fromJSON(t){return super.fromJSON(t),this.aX=t.aX,this.aY=t.aY,this.xRadius=t.xRadius,this.yRadius=t.yRadius,this.aStartAngle=t.aStartAngle,this.aEndAngle=t.aEndAngle,this.aClockwise=t.aClockwise,this.aRotation=t.aRotation,this}}class _1 extends Qm{constructor(t,e,a,o,l,u){super(t,e,a,a,o,l,u),this.isArcCurve=!0,this.type="ArcCurve"}}function $m(){let s=0,t=0,e=0,a=0;function o(l,u,h,d){s=l,t=h,e=-3*l+3*u-2*h-d,a=2*l-2*u+h+d}return{initCatmullRom:function(l,u,h,d,p){o(u,h,p*(h-l),p*(d-u))},initNonuniformCatmullRom:function(l,u,h,d,p,g,_){let v=(u-l)/p-(h-l)/(p+g)+(h-u)/g,x=(h-u)/g-(d-u)/(g+_)+(d-h)/_;v*=g,x*=g,o(u,h,v,x)},calc:function(l){const u=l*l,h=u*l;return s+t*l+e*u+a*h}}}const Bx=new q,Ix=new q,fp=new $m,hp=new $m,dp=new $m;class iS extends va{constructor(t=[],e=!1,a="centripetal",o=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=t,this.closed=e,this.curveType=a,this.tension=o}getPoint(t,e=new q){const a=e,o=this.points,l=o.length,u=(l-(this.closed?0:1))*t;let h=Math.floor(u),d=u-h;this.closed?h+=h>0?0:(Math.floor(Math.abs(h)/l)+1)*l:d===0&&h===l-1&&(h=l-2,d=1);let p,g;this.closed||h>0?p=o[(h-1)%l]:(Ix.subVectors(o[0],o[1]).add(o[0]),p=Ix);const _=o[h%l],v=o[(h+1)%l];if(this.closed||h+2<l?g=o[(h+2)%l]:(Bx.subVectors(o[l-1],o[l-2]).add(o[l-1]),g=Bx),this.curveType==="centripetal"||this.curveType==="chordal"){const x=this.curveType==="chordal"?.5:.25;let b=Math.pow(p.distanceToSquared(_),x),C=Math.pow(_.distanceToSquared(v),x),M=Math.pow(v.distanceToSquared(g),x);C<1e-4&&(C=1),b<1e-4&&(b=C),M<1e-4&&(M=C),fp.initNonuniformCatmullRom(p.x,_.x,v.x,g.x,b,C,M),hp.initNonuniformCatmullRom(p.y,_.y,v.y,g.y,b,C,M),dp.initNonuniformCatmullRom(p.z,_.z,v.z,g.z,b,C,M)}else this.curveType==="catmullrom"&&(fp.initCatmullRom(p.x,_.x,v.x,g.x,this.tension),hp.initCatmullRom(p.y,_.y,v.y,g.y,this.tension),dp.initCatmullRom(p.z,_.z,v.z,g.z,this.tension));return a.set(fp.calc(d),hp.calc(d),dp.calc(d)),a}copy(t){super.copy(t),this.points=[];for(let e=0,a=t.points.length;e<a;e++){const o=t.points[e];this.points.push(o.clone())}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}toJSON(){const t=super.toJSON();t.points=[];for(let e=0,a=this.points.length;e<a;e++){const o=this.points[e];t.points.push(o.toArray())}return t.closed=this.closed,t.curveType=this.curveType,t.tension=this.tension,t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,a=t.points.length;e<a;e++){const o=t.points[e];this.points.push(new q().fromArray(o))}return this.closed=t.closed,this.curveType=t.curveType,this.tension=t.tension,this}}function zx(s,t,e,a,o){const l=(a-t)*.5,u=(o-e)*.5,h=s*s,d=s*h;return(2*e-2*a+l+u)*d+(-3*e+3*a-2*l-u)*h+l*s+e}function x1(s,t){const e=1-s;return e*e*t}function y1(s,t){return 2*(1-s)*s*t}function S1(s,t){return s*s*t}function jl(s,t,e,a){return x1(s,t)+y1(s,e)+S1(s,a)}function M1(s,t){const e=1-s;return e*e*e*t}function b1(s,t){const e=1-s;return 3*e*e*s*t}function E1(s,t){return 3*(1-s)*s*s*t}function T1(s,t){return s*s*s*t}function tc(s,t,e,a,o){return M1(s,t)+b1(s,e)+E1(s,a)+T1(s,o)}class aS extends va{constructor(t=new Ut,e=new Ut,a=new Ut,o=new Ut){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=t,this.v1=e,this.v2=a,this.v3=o}getPoint(t,e=new Ut){const a=e,o=this.v0,l=this.v1,u=this.v2,h=this.v3;return a.set(tc(t,o.x,l.x,u.x,h.x),tc(t,o.y,l.y,u.y,h.y)),a}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){const t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}}class A1 extends va{constructor(t=new q,e=new q,a=new q,o=new q){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=t,this.v1=e,this.v2=a,this.v3=o}getPoint(t,e=new q){const a=e,o=this.v0,l=this.v1,u=this.v2,h=this.v3;return a.set(tc(t,o.x,l.x,u.x,h.x),tc(t,o.y,l.y,u.y,h.y),tc(t,o.z,l.z,u.z,h.z)),a}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this.v3.copy(t.v3),this}toJSON(){const t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t.v3=this.v3.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this.v3.fromArray(t.v3),this}}class sS extends va{constructor(t=new Ut,e=new Ut){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=t,this.v2=e}getPoint(t,e=new Ut){const a=e;return t===1?a.copy(this.v2):(a.copy(this.v2).sub(this.v1),a.multiplyScalar(t).add(this.v1)),a}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new Ut){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){const t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}}class w1 extends va{constructor(t=new q,e=new q){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=t,this.v2=e}getPoint(t,e=new q){const a=e;return t===1?a.copy(this.v2):(a.copy(this.v2).sub(this.v1),a.multiplyScalar(t).add(this.v1)),a}getPointAt(t,e){return this.getPoint(t,e)}getTangent(t,e=new q){return e.subVectors(this.v2,this.v1).normalize()}getTangentAt(t,e){return this.getTangent(t,e)}copy(t){return super.copy(t),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){const t=super.toJSON();return t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}}class rS extends va{constructor(t=new Ut,e=new Ut,a=new Ut){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=t,this.v1=e,this.v2=a}getPoint(t,e=new Ut){const a=e,o=this.v0,l=this.v1,u=this.v2;return a.set(jl(t,o.x,l.x,u.x),jl(t,o.y,l.y,u.y)),a}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){const t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}}class oS extends va{constructor(t=new q,e=new q,a=new q){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=t,this.v1=e,this.v2=a}getPoint(t,e=new q){const a=e,o=this.v0,l=this.v1,u=this.v2;return a.set(jl(t,o.x,l.x,u.x),jl(t,o.y,l.y,u.y),jl(t,o.z,l.z,u.z)),a}copy(t){return super.copy(t),this.v0.copy(t.v0),this.v1.copy(t.v1),this.v2.copy(t.v2),this}toJSON(){const t=super.toJSON();return t.v0=this.v0.toArray(),t.v1=this.v1.toArray(),t.v2=this.v2.toArray(),t}fromJSON(t){return super.fromJSON(t),this.v0.fromArray(t.v0),this.v1.fromArray(t.v1),this.v2.fromArray(t.v2),this}}class lS extends va{constructor(t=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=t}getPoint(t,e=new Ut){const a=e,o=this.points,l=(o.length-1)*t,u=Math.floor(l),h=l-u,d=o[u===0?u:u-1],p=o[u],g=o[u>o.length-2?o.length-1:u+1],_=o[u>o.length-3?o.length-1:u+2];return a.set(zx(h,d.x,p.x,g.x,_.x),zx(h,d.y,p.y,g.y,_.y)),a}copy(t){super.copy(t),this.points=[];for(let e=0,a=t.points.length;e<a;e++){const o=t.points[e];this.points.push(o.clone())}return this}toJSON(){const t=super.toJSON();t.points=[];for(let e=0,a=this.points.length;e<a;e++){const o=this.points[e];t.points.push(o.toArray())}return t}fromJSON(t){super.fromJSON(t),this.points=[];for(let e=0,a=t.points.length;e<a;e++){const o=t.points[e];this.points.push(new Ut().fromArray(o))}return this}}var xf=Object.freeze({__proto__:null,ArcCurve:_1,CatmullRomCurve3:iS,CubicBezierCurve:aS,CubicBezierCurve3:A1,EllipseCurve:Qm,LineCurve:sS,LineCurve3:w1,QuadraticBezierCurve:rS,QuadraticBezierCurve3:oS,SplineCurve:lS});class R1 extends va{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(t){this.curves.push(t)}closePath(){const t=this.curves[0].getPoint(0),e=this.curves[this.curves.length-1].getPoint(1);if(!t.equals(e)){const a=t.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new xf[a](e,t))}return this}getPoint(t,e){const a=t*this.getLength(),o=this.getCurveLengths();let l=0;for(;l<o.length;){if(o[l]>=a){const u=o[l]-a,h=this.curves[l],d=h.getLength(),p=d===0?0:1-u/d;return h.getPointAt(p,e)}l++}return null}getLength(){const t=this.getCurveLengths();return t[t.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;const t=[];let e=0;for(let a=0,o=this.curves.length;a<o;a++)e+=this.curves[a].getLength(),t.push(e);return this.cacheLengths=t,t}getSpacedPoints(t=40){const e=[];for(let a=0;a<=t;a++)e.push(this.getPoint(a/t));return this.autoClose&&e.push(e[0]),e}getPoints(t=12){const e=[];let a;for(let o=0,l=this.curves;o<l.length;o++){const u=l[o],h=u.isEllipseCurve?t*2:u.isLineCurve||u.isLineCurve3?1:u.isSplineCurve?t*u.points.length:t,d=u.getPoints(h);for(let p=0;p<d.length;p++){const g=d[p];a&&a.equals(g)||(e.push(g),a=g)}}return this.autoClose&&e.length>1&&!e[e.length-1].equals(e[0])&&e.push(e[0]),e}copy(t){super.copy(t),this.curves=[];for(let e=0,a=t.curves.length;e<a;e++){const o=t.curves[e];this.curves.push(o.clone())}return this.autoClose=t.autoClose,this}toJSON(){const t=super.toJSON();t.autoClose=this.autoClose,t.curves=[];for(let e=0,a=this.curves.length;e<a;e++){const o=this.curves[e];t.curves.push(o.toJSON())}return t}fromJSON(t){super.fromJSON(t),this.autoClose=t.autoClose,this.curves=[];for(let e=0,a=t.curves.length;e<a;e++){const o=t.curves[e];this.curves.push(new xf[o.type]().fromJSON(o))}return this}}class Fx extends R1{constructor(t){super(),this.type="Path",this.currentPoint=new Ut,t&&this.setFromPoints(t)}setFromPoints(t){this.moveTo(t[0].x,t[0].y);for(let e=1,a=t.length;e<a;e++)this.lineTo(t[e].x,t[e].y);return this}moveTo(t,e){return this.currentPoint.set(t,e),this}lineTo(t,e){const a=new sS(this.currentPoint.clone(),new Ut(t,e));return this.curves.push(a),this.currentPoint.set(t,e),this}quadraticCurveTo(t,e,a,o){const l=new rS(this.currentPoint.clone(),new Ut(t,e),new Ut(a,o));return this.curves.push(l),this.currentPoint.set(a,o),this}bezierCurveTo(t,e,a,o,l,u){const h=new aS(this.currentPoint.clone(),new Ut(t,e),new Ut(a,o),new Ut(l,u));return this.curves.push(h),this.currentPoint.set(l,u),this}splineThru(t){const e=[this.currentPoint.clone()].concat(t),a=new lS(e);return this.curves.push(a),this.currentPoint.copy(t[t.length-1]),this}arc(t,e,a,o,l,u){const h=this.currentPoint.x,d=this.currentPoint.y;return this.absarc(t+h,e+d,a,o,l,u),this}absarc(t,e,a,o,l,u){return this.absellipse(t,e,a,a,o,l,u),this}ellipse(t,e,a,o,l,u,h,d){const p=this.currentPoint.x,g=this.currentPoint.y;return this.absellipse(t+p,e+g,a,o,l,u,h,d),this}absellipse(t,e,a,o,l,u,h,d){const p=new Qm(t,e,a,o,l,u,h,d);if(this.curves.length>0){const _=p.getPoint(0);_.equals(this.currentPoint)||this.lineTo(_.x,_.y)}this.curves.push(p);const g=p.getPoint(1);return this.currentPoint.copy(g),this}copy(t){return super.copy(t),this.currentPoint.copy(t.currentPoint),this}toJSON(){const t=super.toJSON();return t.currentPoint=this.currentPoint.toArray(),t}fromJSON(t){return super.fromJSON(t),this.currentPoint.fromArray(t.currentPoint),this}}class cS extends Fx{constructor(t){super(t),this.uuid=Ka(),this.type="Shape",this.holes=[]}getPointsHoles(t){const e=[];for(let a=0,o=this.holes.length;a<o;a++)e[a]=this.holes[a].getPoints(t);return e}extractPoints(t){return{shape:this.getPoints(t),holes:this.getPointsHoles(t)}}copy(t){super.copy(t),this.holes=[];for(let e=0,a=t.holes.length;e<a;e++){const o=t.holes[e];this.holes.push(o.clone())}return this}toJSON(){const t=super.toJSON();t.uuid=this.uuid,t.holes=[];for(let e=0,a=this.holes.length;e<a;e++){const o=this.holes[e];t.holes.push(o.toJSON())}return t}fromJSON(t){super.fromJSON(t),this.uuid=t.uuid,this.holes=[];for(let e=0,a=t.holes.length;e<a;e++){const o=t.holes[e];this.holes.push(new Fx().fromJSON(o))}return this}}function C1(s,t,e=2){const a=t&&t.length,o=a?t[0]*e:s.length;let l=uS(s,0,o,e,!0);const u=[];if(!l||l.next===l.prev)return u;let h,d,p;if(a&&(l=O1(s,t,l,e)),s.length>80*e){h=s[0],d=s[1];let g=h,_=d;for(let v=e;v<o;v+=e){const x=s[v],b=s[v+1];x<h&&(h=x),b<d&&(d=b),x>g&&(g=x),b>_&&(_=b)}p=Math.max(g-h,_-d),p=p!==0?32767/p:0}return fc(l,u,e,h,d,p,0),u}function uS(s,t,e,a,o){let l;if(o===W1(s,t,e,a)>0)for(let u=t;u<e;u+=a)l=Hx(u/a|0,s[u],s[u+1],l);else for(let u=e-a;u>=t;u-=a)l=Hx(u/a|0,s[u],s[u+1],l);return l&&Go(l,l.next)&&(dc(l),l=l.next),l}function Mr(s,t){if(!s)return s;t||(t=s);let e=s,a;do if(a=!1,!e.steiner&&(Go(e,e.next)||mn(e.prev,e,e.next)===0)){if(dc(e),e=t=e.prev,e===e.next)break;a=!0}else e=e.next;while(a||e!==t);return t}function fc(s,t,e,a,o,l,u){if(!s)return;!u&&l&&F1(s,a,o,l);let h=s;for(;s.prev!==s.next;){const d=s.prev,p=s.next;if(l?U1(s,a,o,l):D1(s)){t.push(d.i,s.i,p.i),dc(s),s=p.next,h=p.next;continue}if(s=p,s===h){u?u===1?(s=L1(Mr(s),t),fc(s,t,e,a,o,l,2)):u===2&&N1(s,t,e,a,o,l):fc(Mr(s),t,e,a,o,l,1);break}}}function D1(s){const t=s.prev,e=s,a=s.next;if(mn(t,e,a)>=0)return!1;const o=t.x,l=e.x,u=a.x,h=t.y,d=e.y,p=a.y,g=Math.min(o,l,u),_=Math.min(h,d,p),v=Math.max(o,l,u),x=Math.max(h,d,p);let b=a.next;for(;b!==t;){if(b.x>=g&&b.x<=v&&b.y>=_&&b.y<=x&&Jl(o,h,l,d,u,p,b.x,b.y)&&mn(b.prev,b,b.next)>=0)return!1;b=b.next}return!0}function U1(s,t,e,a){const o=s.prev,l=s,u=s.next;if(mn(o,l,u)>=0)return!1;const h=o.x,d=l.x,p=u.x,g=o.y,_=l.y,v=u.y,x=Math.min(h,d,p),b=Math.min(g,_,v),C=Math.max(h,d,p),M=Math.max(g,_,v),y=gm(x,b,t,e,a),I=gm(C,M,t,e,a);let D=s.prevZ,A=s.nextZ;for(;D&&D.z>=y&&A&&A.z<=I;){if(D.x>=x&&D.x<=C&&D.y>=b&&D.y<=M&&D!==o&&D!==u&&Jl(h,g,d,_,p,v,D.x,D.y)&&mn(D.prev,D,D.next)>=0||(D=D.prevZ,A.x>=x&&A.x<=C&&A.y>=b&&A.y<=M&&A!==o&&A!==u&&Jl(h,g,d,_,p,v,A.x,A.y)&&mn(A.prev,A,A.next)>=0))return!1;A=A.nextZ}for(;D&&D.z>=y;){if(D.x>=x&&D.x<=C&&D.y>=b&&D.y<=M&&D!==o&&D!==u&&Jl(h,g,d,_,p,v,D.x,D.y)&&mn(D.prev,D,D.next)>=0)return!1;D=D.prevZ}for(;A&&A.z<=I;){if(A.x>=x&&A.x<=C&&A.y>=b&&A.y<=M&&A!==o&&A!==u&&Jl(h,g,d,_,p,v,A.x,A.y)&&mn(A.prev,A,A.next)>=0)return!1;A=A.nextZ}return!0}function L1(s,t){let e=s;do{const a=e.prev,o=e.next.next;!Go(a,o)&&hS(a,e,e.next,o)&&hc(a,o)&&hc(o,a)&&(t.push(a.i,e.i,o.i),dc(e),dc(e.next),e=s=o),e=e.next}while(e!==s);return Mr(e)}function N1(s,t,e,a,o,l){let u=s;do{let h=u.next.next;for(;h!==u.prev;){if(u.i!==h.i&&V1(u,h)){let d=dS(u,h);u=Mr(u,u.next),d=Mr(d,d.next),fc(u,t,e,a,o,l,0),fc(d,t,e,a,o,l,0);return}h=h.next}u=u.next}while(u!==s)}function O1(s,t,e,a){const o=[];for(let l=0,u=t.length;l<u;l++){const h=t[l]*a,d=l<u-1?t[l+1]*a:s.length,p=uS(s,h,d,a,!1);p===p.next&&(p.steiner=!0),o.push(G1(p))}o.sort(P1);for(let l=0;l<o.length;l++)e=B1(o[l],e);return e}function P1(s,t){let e=s.x-t.x;if(e===0&&(e=s.y-t.y,e===0)){const a=(s.next.y-s.y)/(s.next.x-s.x),o=(t.next.y-t.y)/(t.next.x-t.x);e=a-o}return e}function B1(s,t){const e=I1(s,t);if(!e)return t;const a=dS(e,s);return Mr(a,a.next),Mr(e,e.next)}function I1(s,t){let e=t;const a=s.x,o=s.y;let l=-1/0,u;if(Go(s,e))return e;do{if(Go(s,e.next))return e.next;if(o<=e.y&&o>=e.next.y&&e.next.y!==e.y){const _=e.x+(o-e.y)*(e.next.x-e.x)/(e.next.y-e.y);if(_<=a&&_>l&&(l=_,u=e.x<e.next.x?e:e.next,_===a))return u}e=e.next}while(e!==t);if(!u)return null;const h=u,d=u.x,p=u.y;let g=1/0;e=u;do{if(a>=e.x&&e.x>=d&&a!==e.x&&fS(o<p?a:l,o,d,p,o<p?l:a,o,e.x,e.y)){const _=Math.abs(o-e.y)/(a-e.x);hc(e,s)&&(_<g||_===g&&(e.x>u.x||e.x===u.x&&z1(u,e)))&&(u=e,g=_)}e=e.next}while(e!==h);return u}function z1(s,t){return mn(s.prev,s,t.prev)<0&&mn(t.next,s,s.next)<0}function F1(s,t,e,a){let o=s;do o.z===0&&(o.z=gm(o.x,o.y,t,e,a)),o.prevZ=o.prev,o.nextZ=o.next,o=o.next;while(o!==s);o.prevZ.nextZ=null,o.prevZ=null,H1(o)}function H1(s){let t,e=1;do{let a=s,o;s=null;let l=null;for(t=0;a;){t++;let u=a,h=0;for(let p=0;p<e&&(h++,u=u.nextZ,!!u);p++);let d=e;for(;h>0||d>0&&u;)h!==0&&(d===0||!u||a.z<=u.z)?(o=a,a=a.nextZ,h--):(o=u,u=u.nextZ,d--),l?l.nextZ=o:s=o,o.prevZ=l,l=o;a=u}l.nextZ=null,e*=2}while(t>1);return s}function gm(s,t,e,a,o){return s=(s-e)*o|0,t=(t-a)*o|0,s=(s|s<<8)&16711935,s=(s|s<<4)&252645135,s=(s|s<<2)&858993459,s=(s|s<<1)&1431655765,t=(t|t<<8)&16711935,t=(t|t<<4)&252645135,t=(t|t<<2)&858993459,t=(t|t<<1)&1431655765,s|t<<1}function G1(s){let t=s,e=s;do(t.x<e.x||t.x===e.x&&t.y<e.y)&&(e=t),t=t.next;while(t!==s);return e}function fS(s,t,e,a,o,l,u,h){return(o-u)*(t-h)>=(s-u)*(l-h)&&(s-u)*(a-h)>=(e-u)*(t-h)&&(e-u)*(l-h)>=(o-u)*(a-h)}function Jl(s,t,e,a,o,l,u,h){return!(s===u&&t===h)&&fS(s,t,e,a,o,l,u,h)}function V1(s,t){return s.next.i!==t.i&&s.prev.i!==t.i&&!k1(s,t)&&(hc(s,t)&&hc(t,s)&&X1(s,t)&&(mn(s.prev,s,t.prev)||mn(s,t.prev,t))||Go(s,t)&&mn(s.prev,s,s.next)>0&&mn(t.prev,t,t.next)>0)}function mn(s,t,e){return(t.y-s.y)*(e.x-t.x)-(t.x-s.x)*(e.y-t.y)}function Go(s,t){return s.x===t.x&&s.y===t.y}function hS(s,t,e,a){const o=Ku(mn(s,t,e)),l=Ku(mn(s,t,a)),u=Ku(mn(e,a,s)),h=Ku(mn(e,a,t));return!!(o!==l&&u!==h||o===0&&Zu(s,e,t)||l===0&&Zu(s,a,t)||u===0&&Zu(e,s,a)||h===0&&Zu(e,t,a))}function Zu(s,t,e){return t.x<=Math.max(s.x,e.x)&&t.x>=Math.min(s.x,e.x)&&t.y<=Math.max(s.y,e.y)&&t.y>=Math.min(s.y,e.y)}function Ku(s){return s>0?1:s<0?-1:0}function k1(s,t){let e=s;do{if(e.i!==s.i&&e.next.i!==s.i&&e.i!==t.i&&e.next.i!==t.i&&hS(e,e.next,s,t))return!0;e=e.next}while(e!==s);return!1}function hc(s,t){return mn(s.prev,s,s.next)<0?mn(s,t,s.next)>=0&&mn(s,s.prev,t)>=0:mn(s,t,s.prev)<0||mn(s,s.next,t)<0}function X1(s,t){let e=s,a=!1;const o=(s.x+t.x)/2,l=(s.y+t.y)/2;do e.y>l!=e.next.y>l&&e.next.y!==e.y&&o<(e.next.x-e.x)*(l-e.y)/(e.next.y-e.y)+e.x&&(a=!a),e=e.next;while(e!==s);return a}function dS(s,t){const e=vm(s.i,s.x,s.y),a=vm(t.i,t.x,t.y),o=s.next,l=t.prev;return s.next=t,t.prev=s,e.next=o,o.prev=e,a.next=e,e.prev=a,l.next=a,a.prev=l,a}function Hx(s,t,e,a){const o=vm(s,t,e);return a?(o.next=a.next,o.prev=a,a.next.prev=o,a.next=o):(o.prev=o,o.next=o),o}function dc(s){s.next.prev=s.prev,s.prev.next=s.next,s.prevZ&&(s.prevZ.nextZ=s.nextZ),s.nextZ&&(s.nextZ.prevZ=s.prevZ)}function vm(s,t,e){return{i:s,x:t,y:e,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function W1(s,t,e,a){let o=0;for(let l=t,u=e-a;l<e;l+=a)o+=(s[u]-s[l])*(s[l+1]+s[u+1]),u=l;return o}class q1{static triangulate(t,e,a=2){return C1(t,e,a)}}class Co{static area(t){const e=t.length;let a=0;for(let o=e-1,l=0;l<e;o=l++)a+=t[o].x*t[l].y-t[l].x*t[o].y;return a*.5}static isClockWise(t){return Co.area(t)<0}static triangulateShape(t,e){const a=[],o=[],l=[];Gx(t),Vx(a,t);let u=t.length;e.forEach(Gx);for(let d=0;d<e.length;d++)o.push(u),u+=e[d].length,Vx(a,e[d]);const h=q1.triangulate(a,o);for(let d=0;d<h.length;d+=3)l.push(h.slice(d,d+3));return l}}function Gx(s){const t=s.length;t>2&&s[t-1].equals(s[0])&&s.pop()}function Vx(s,t){for(let e=0;e<t.length;e++)s.push(t[e].x),s.push(t[e].y)}class ec extends li{constructor(t=new cS([new Ut(.5,.5),new Ut(-.5,.5),new Ut(-.5,-.5),new Ut(.5,-.5)]),e={}){super(),this.type="ExtrudeGeometry",this.parameters={shapes:t,options:e},t=Array.isArray(t)?t:[t];const a=this,o=[],l=[];for(let h=0,d=t.length;h<d;h++){const p=t[h];u(p)}this.setAttribute("position",new gn(o,3)),this.setAttribute("uv",new gn(l,2)),this.computeVertexNormals();function u(h){const d=[],p=e.curveSegments!==void 0?e.curveSegments:12,g=e.steps!==void 0?e.steps:1,_=e.depth!==void 0?e.depth:1;let v=e.bevelEnabled!==void 0?e.bevelEnabled:!0,x=e.bevelThickness!==void 0?e.bevelThickness:.2,b=e.bevelSize!==void 0?e.bevelSize:x-.1,C=e.bevelOffset!==void 0?e.bevelOffset:0,M=e.bevelSegments!==void 0?e.bevelSegments:3;const y=e.extrudePath,I=e.UVGenerator!==void 0?e.UVGenerator:Y1;let D,A=!1,O,U,z,T;if(y){D=y.getSpacedPoints(g),A=!0,v=!1;const Tt=y.isCatmullRomCurve3?y.closed:!1;O=y.computeFrenetFrames(g,Tt),U=new q,z=new q,T=new q}v||(M=0,x=0,b=0,C=0);const P=h.extractPoints(p);let k=P.shape;const H=P.holes;if(!Co.isClockWise(k)){k=k.reverse();for(let Tt=0,Rt=H.length;Tt<Rt;Tt++){const wt=H[Tt];Co.isClockWise(wt)&&(H[Tt]=wt.reverse())}}function ft(Tt){const wt=10000000000000001e-36;let kt=Tt[0];for(let Gt=1;Gt<=Tt.length;Gt++){const le=Gt%Tt.length,ne=Tt[le],he=ne.x-kt.x,xe=ne.y-kt.y,W=he*he+xe*xe,Me=Math.max(Math.abs(ne.x),Math.abs(ne.y),Math.abs(kt.x),Math.abs(kt.y)),we=wt*Me*Me;if(W<=we){Tt.splice(le,1),Gt--;continue}kt=ne}}ft(k),H.forEach(ft);const dt=H.length,J=k;for(let Tt=0;Tt<dt;Tt++){const Rt=H[Tt];k=k.concat(Rt)}function F(Tt,Rt,wt){return Rt||Oe("ExtrudeGeometry: vec does not exist"),Tt.clone().addScaledVector(Rt,wt)}const N=k.length;function V(Tt,Rt,wt){let kt,Gt,le;const ne=Tt.x-Rt.x,he=Tt.y-Rt.y,xe=wt.x-Tt.x,W=wt.y-Tt.y,Me=ne*ne+he*he,we=ne*W-he*xe;if(Math.abs(we)>Number.EPSILON){const B=Math.sqrt(Me),E=Math.sqrt(xe*xe+W*W),tt=Rt.x-he/B,ot=Rt.y+ne/B,gt=wt.x-W/E,Dt=wt.y+xe/E,Bt=((gt-tt)*W-(Dt-ot)*xe)/(ne*W-he*xe);kt=tt+ne*Bt-Tt.x,Gt=ot+he*Bt-Tt.y;const pt=kt*kt+Gt*Gt;if(pt<=2)return new Ut(kt,Gt);le=Math.sqrt(pt/2)}else{let B=!1;ne>Number.EPSILON?xe>Number.EPSILON&&(B=!0):ne<-Number.EPSILON?xe<-Number.EPSILON&&(B=!0):Math.sign(he)===Math.sign(W)&&(B=!0),B?(kt=-he,Gt=ne,le=Math.sqrt(Me)):(kt=ne,Gt=he,le=Math.sqrt(Me/2))}return new Ut(kt/le,Gt/le)}const nt=[];for(let Tt=0,Rt=J.length,wt=Rt-1,kt=Tt+1;Tt<Rt;Tt++,wt++,kt++)wt===Rt&&(wt=0),kt===Rt&&(kt=0),nt[Tt]=V(J[Tt],J[wt],J[kt]);const mt=[];let L,X=nt.concat();for(let Tt=0,Rt=dt;Tt<Rt;Tt++){const wt=H[Tt];L=[];for(let kt=0,Gt=wt.length,le=Gt-1,ne=kt+1;kt<Gt;kt++,le++,ne++)le===Gt&&(le=0),ne===Gt&&(ne=0),L[kt]=V(wt[kt],wt[le],wt[ne]);mt.push(L),X=X.concat(L)}let _t;if(M===0)_t=Co.triangulateShape(J,H);else{const Tt=[],Rt=[];for(let wt=0;wt<M;wt++){const kt=wt/M,Gt=x*Math.cos(kt*Math.PI/2),le=b*Math.sin(kt*Math.PI/2)+C;for(let ne=0,he=J.length;ne<he;ne++){const xe=F(J[ne],nt[ne],le);zt(xe.x,xe.y,-Gt),kt===0&&Tt.push(xe)}for(let ne=0,he=dt;ne<he;ne++){const xe=H[ne];L=mt[ne];const W=[];for(let Me=0,we=xe.length;Me<we;Me++){const B=F(xe[Me],L[Me],le);zt(B.x,B.y,-Gt),kt===0&&W.push(B)}kt===0&&Rt.push(W)}}_t=Co.triangulateShape(Tt,Rt)}const Ct=_t.length,Lt=b+C;for(let Tt=0;Tt<N;Tt++){const Rt=v?F(k[Tt],X[Tt],Lt):k[Tt];A?(z.copy(O.normals[0]).multiplyScalar(Rt.x),U.copy(O.binormals[0]).multiplyScalar(Rt.y),T.copy(D[0]).add(z).add(U),zt(T.x,T.y,T.z)):zt(Rt.x,Rt.y,0)}for(let Tt=1;Tt<=g;Tt++)for(let Rt=0;Rt<N;Rt++){const wt=v?F(k[Rt],X[Rt],Lt):k[Rt];A?(z.copy(O.normals[Tt]).multiplyScalar(wt.x),U.copy(O.binormals[Tt]).multiplyScalar(wt.y),T.copy(D[Tt]).add(z).add(U),zt(T.x,T.y,T.z)):zt(wt.x,wt.y,_/g*Tt)}for(let Tt=M-1;Tt>=0;Tt--){const Rt=Tt/M,wt=x*Math.cos(Rt*Math.PI/2),kt=b*Math.sin(Rt*Math.PI/2)+C;for(let Gt=0,le=J.length;Gt<le;Gt++){const ne=F(J[Gt],nt[Gt],kt);zt(ne.x,ne.y,_+wt)}for(let Gt=0,le=H.length;Gt<le;Gt++){const ne=H[Gt];L=mt[Gt];for(let he=0,xe=ne.length;he<xe;he++){const W=F(ne[he],L[he],kt);A?zt(W.x,W.y+D[g-1].y,D[g-1].x+wt):zt(W.x,W.y,_+wt)}}}et(),Mt();function et(){const Tt=o.length/3;if(v){let Rt=0,wt=N*Rt;for(let kt=0;kt<Ct;kt++){const Gt=_t[kt];oe(Gt[2]+wt,Gt[1]+wt,Gt[0]+wt)}Rt=g+M*2,wt=N*Rt;for(let kt=0;kt<Ct;kt++){const Gt=_t[kt];oe(Gt[0]+wt,Gt[1]+wt,Gt[2]+wt)}}else{for(let Rt=0;Rt<Ct;Rt++){const wt=_t[Rt];oe(wt[2],wt[1],wt[0])}for(let Rt=0;Rt<Ct;Rt++){const wt=_t[Rt];oe(wt[0]+N*g,wt[1]+N*g,wt[2]+N*g)}}a.addGroup(Tt,o.length/3-Tt,0)}function Mt(){const Tt=o.length/3;let Rt=0;Et(J,Rt),Rt+=J.length;for(let wt=0,kt=H.length;wt<kt;wt++){const Gt=H[wt];Et(Gt,Rt),Rt+=Gt.length}a.addGroup(Tt,o.length/3-Tt,1)}function Et(Tt,Rt){let wt=Tt.length;for(;--wt>=0;){const kt=wt;let Gt=wt-1;Gt<0&&(Gt=Tt.length-1);for(let le=0,ne=g+M*2;le<ne;le++){const he=N*le,xe=N*(le+1),W=Rt+kt+he,Me=Rt+Gt+he,we=Rt+Gt+xe,B=Rt+kt+xe;ae(W,Me,we,B)}}}function zt(Tt,Rt,wt){d.push(Tt),d.push(Rt),d.push(wt)}function oe(Tt,Rt,wt){Pe(Tt),Pe(Rt),Pe(wt);const kt=o.length/3,Gt=I.generateTopUV(a,o,kt-3,kt-2,kt-1);me(Gt[0]),me(Gt[1]),me(Gt[2])}function ae(Tt,Rt,wt,kt){Pe(Tt),Pe(Rt),Pe(kt),Pe(Rt),Pe(wt),Pe(kt);const Gt=o.length/3,le=I.generateSideWallUV(a,o,Gt-6,Gt-3,Gt-2,Gt-1);me(le[0]),me(le[1]),me(le[3]),me(le[1]),me(le[2]),me(le[3])}function Pe(Tt){o.push(d[Tt*3+0]),o.push(d[Tt*3+1]),o.push(d[Tt*3+2])}function me(Tt){l.push(Tt.x),l.push(Tt.y)}}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){const t=super.toJSON(),e=this.parameters.shapes,a=this.parameters.options;return Z1(e,a,t)}static fromJSON(t,e){const a=[];for(let l=0,u=t.shapes.length;l<u;l++){const h=e[t.shapes[l]];a.push(h)}const o=t.options.extrudePath;return o!==void 0&&(t.options.extrudePath=new xf[o.type]().fromJSON(o)),new ec(a,t.options)}}const Y1={generateTopUV:function(s,t,e,a,o){const l=t[e*3],u=t[e*3+1],h=t[a*3],d=t[a*3+1],p=t[o*3],g=t[o*3+1];return[new Ut(l,u),new Ut(h,d),new Ut(p,g)]},generateSideWallUV:function(s,t,e,a,o,l){const u=t[e*3],h=t[e*3+1],d=t[e*3+2],p=t[a*3],g=t[a*3+1],_=t[a*3+2],v=t[o*3],x=t[o*3+1],b=t[o*3+2],C=t[l*3],M=t[l*3+1],y=t[l*3+2];return Math.abs(h-g)<Math.abs(u-p)?[new Ut(u,1-d),new Ut(p,1-_),new Ut(v,1-b),new Ut(C,1-y)]:[new Ut(h,1-d),new Ut(g,1-_),new Ut(x,1-b),new Ut(M,1-y)]}};function Z1(s,t,e){if(e.shapes=[],Array.isArray(s))for(let a=0,o=s.length;a<o;a++){const l=s[a];e.shapes.push(l.uuid)}else e.shapes.push(s.uuid);return e.options=Object.assign({},t),t.extrudePath!==void 0&&(e.options.extrudePath=t.extrudePath.toJSON()),e}class Vo extends li{constructor(t=1,e=1,a=1,o=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:a,heightSegments:o};const l=t/2,u=e/2,h=Math.floor(a),d=Math.floor(o),p=h+1,g=d+1,_=t/h,v=e/d,x=[],b=[],C=[],M=[];for(let y=0;y<g;y++){const I=y*v-u;for(let D=0;D<p;D++){const A=D*_-l;b.push(A,-I,0),C.push(0,0,1),M.push(D/h),M.push(1-y/d)}}for(let y=0;y<d;y++)for(let I=0;I<h;I++){const D=I+p*y,A=I+p*(y+1),O=I+1+p*(y+1),U=I+1+p*y;x.push(D,A,U),x.push(A,O,U)}this.setIndex(x),this.setAttribute("position",new gn(b,3)),this.setAttribute("normal",new gn(C,3)),this.setAttribute("uv",new gn(M,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Vo(t.width,t.height,t.widthSegments,t.heightSegments)}}class nc extends li{constructor(t=1,e=32,a=16,o=0,l=Math.PI*2,u=0,h=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:a,phiStart:o,phiLength:l,thetaStart:u,thetaLength:h},e=Math.max(3,Math.floor(e)),a=Math.max(2,Math.floor(a));const d=Math.min(u+h,Math.PI);let p=0;const g=[],_=new q,v=new q,x=[],b=[],C=[],M=[];for(let y=0;y<=a;y++){const I=[],D=y/a,A=u+D*h,O=t*Math.cos(A),U=Math.sqrt(t*t-O*O);let z=0;y===0&&u===0?z=.5/e:y===a&&d===Math.PI&&(z=-.5/e);for(let T=0;T<=e;T++){const P=T/e,k=o+P*l;_.x=-U*Math.cos(k),_.y=O,_.z=U*Math.sin(k),b.push(_.x,_.y,_.z),v.copy(_).normalize(),C.push(v.x,v.y,v.z),M.push(P+z,1-D),I.push(p++)}g.push(I)}for(let y=0;y<a;y++)for(let I=0;I<e;I++){const D=g[y][I+1],A=g[y][I],O=g[y+1][I],U=g[y+1][I+1];(y!==0||u>0)&&x.push(D,A,U),(y!==a-1||d<Math.PI)&&x.push(A,O,U)}this.setIndex(x),this.setAttribute("position",new gn(b,3)),this.setAttribute("normal",new gn(C,3)),this.setAttribute("uv",new gn(M,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new nc(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}}class jm extends li{constructor(t=new oS(new q(-1,-1,0),new q(-1,1,0),new q(1,1,0)),e=64,a=1,o=8,l=!1){super(),this.type="TubeGeometry",this.parameters={path:t,tubularSegments:e,radius:a,radialSegments:o,closed:l};const u=t.computeFrenetFrames(e,l);this.tangents=u.tangents,this.normals=u.normals,this.binormals=u.binormals;const h=new q,d=new q,p=new Ut;let g=new q;const _=[],v=[],x=[],b=[];C(),this.setIndex(b),this.setAttribute("position",new gn(_,3)),this.setAttribute("normal",new gn(v,3)),this.setAttribute("uv",new gn(x,2));function C(){for(let D=0;D<e;D++)M(D);M(l===!1?e:0),I(),y()}function M(D){g=t.getPointAt(D/e,g);const A=u.normals[D],O=u.binormals[D];for(let U=0;U<=o;U++){const z=U/o*Math.PI*2,T=Math.sin(z),P=-Math.cos(z);d.x=P*A.x+T*O.x,d.y=P*A.y+T*O.y,d.z=P*A.z+T*O.z,d.normalize(),v.push(d.x,d.y,d.z),h.x=g.x+a*d.x,h.y=g.y+a*d.y,h.z=g.z+a*d.z,_.push(h.x,h.y,h.z)}}function y(){for(let D=1;D<=e;D++)for(let A=1;A<=o;A++){const O=(o+1)*(D-1)+(A-1),U=(o+1)*D+(A-1),z=(o+1)*D+A,T=(o+1)*(D-1)+A;b.push(O,U,T),b.push(U,z,T)}}function I(){for(let D=0;D<=e;D++)for(let A=0;A<=o;A++)p.x=D/e,p.y=A/o,x.push(p.x,p.y)}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}toJSON(){const t=super.toJSON();return t.path=this.parameters.path.toJSON(),t}static fromJSON(t){return new jm(new xf[t.path.type]().fromJSON(t.path),t.tubularSegments,t.radius,t.radialSegments,t.closed)}}function ko(s){const t={};for(const e in s){t[e]={};for(const a in s[e]){const o=s[e][a];if(kx(o))o.isRenderTargetTexture?(ge("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][a]=null):t[e][a]=o.clone();else if(Array.isArray(o))if(kx(o[0])){const l=[];for(let u=0,h=o.length;u<h;u++)l[u]=o[u].clone();t[e][a]=l}else t[e][a]=o.slice();else t[e][a]=o}}return t}function si(s){const t={};for(let e=0;e<s.length;e++){const a=ko(s[e]);for(const o in a)t[o]=a[o]}return t}function kx(s){return s&&(s.isColor||s.isMatrix3||s.isMatrix4||s.isVector2||s.isVector3||s.isVector4||s.isTexture||s.isQuaternion)}function K1(s){const t=[];for(let e=0;e<s.length;e++)t.push(s[e].clone());return t}function pS(s){const t=s.getRenderTarget();return t===null?s.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:Ie.workingColorSpace}const J1={clone:ko,merge:si};var Q1=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,$1=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class Ui extends Ar{constructor(t){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Q1,this.fragmentShader=$1,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=ko(t.uniforms),this.uniformsGroups=K1(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this.defaultAttributeValues=Object.assign({},t.defaultAttributeValues),this.index0AttributeName=t.index0AttributeName,this.uniformsNeedUpdate=t.uniformsNeedUpdate,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const o in this.uniforms){const u=this.uniforms[o].value;u&&u.isTexture?e.uniforms[o]={type:"t",value:u.toJSON(t).uuid}:u&&u.isColor?e.uniforms[o]={type:"c",value:u.getHex()}:u&&u.isVector2?e.uniforms[o]={type:"v2",value:u.toArray()}:u&&u.isVector3?e.uniforms[o]={type:"v3",value:u.toArray()}:u&&u.isVector4?e.uniforms[o]={type:"v4",value:u.toArray()}:u&&u.isMatrix3?e.uniforms[o]={type:"m3",value:u.toArray()}:u&&u.isMatrix4?e.uniforms[o]={type:"m4",value:u.toArray()}:e.uniforms[o]={value:u}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const a={};for(const o in this.extensions)this.extensions[o]===!0&&(a[o]=!0);return Object.keys(a).length>0&&(e.extensions=a),e}fromJSON(t,e){if(super.fromJSON(t,e),t.uniforms!==void 0)for(const a in t.uniforms){const o=t.uniforms[a];switch(this.uniforms[a]={},o.type){case"t":this.uniforms[a].value=e[o.value]||null;break;case"c":this.uniforms[a].value=new pe().setHex(o.value);break;case"v2":this.uniforms[a].value=new Ut().fromArray(o.value);break;case"v3":this.uniforms[a].value=new q().fromArray(o.value);break;case"v4":this.uniforms[a].value=new pn().fromArray(o.value);break;case"m3":this.uniforms[a].value=new Se().fromArray(o.value);break;case"m4":this.uniforms[a].value=new en().fromArray(o.value);break;default:this.uniforms[a].value=o.value}}if(t.defines!==void 0&&(this.defines=t.defines),t.vertexShader!==void 0&&(this.vertexShader=t.vertexShader),t.fragmentShader!==void 0&&(this.fragmentShader=t.fragmentShader),t.glslVersion!==void 0&&(this.glslVersion=t.glslVersion),t.extensions!==void 0)for(const a in t.extensions)this.extensions[a]=t.extensions[a];return t.lights!==void 0&&(this.lights=t.lights),t.clipping!==void 0&&(this.clipping=t.clipping),this}}class j1 extends Ui{constructor(t){super(t),this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}}class ri extends Ar{constructor(t){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new pe(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new pe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=hf,this.normalScale=new Ut(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ts,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class tT extends Ar{constructor(t){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new pe(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new pe(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=hf,this.normalScale=new Ut(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ts,this.combine=Pm,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.envMapIntensity=t.envMapIntensity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class eT extends Ar{constructor(t){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=PE,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}}class nT extends Ar{constructor(t){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}}const pp={enabled:!1,files:{},add:function(s,t){this.enabled!==!1&&(Xx(s)||(this.files[s]=t))},get:function(s){if(this.enabled!==!1&&!Xx(s))return this.files[s]},remove:function(s){delete this.files[s]},clear:function(){this.files={}}};function Xx(s){try{const t=s.slice(s.indexOf(":")+1);return new URL(t).protocol==="blob:"}catch{return!1}}class iT{constructor(t,e,a){const o=this;let l=!1,u=0,h=0,d;const p=[];this.onStart=void 0,this.onLoad=t,this.onProgress=e,this.onError=a,this._abortController=null,this.itemStart=function(g){h++,l===!1&&o.onStart!==void 0&&o.onStart(g,u,h),l=!0},this.itemEnd=function(g){u++,o.onProgress!==void 0&&o.onProgress(g,u,h),u===h&&(l=!1,o.onLoad!==void 0&&o.onLoad())},this.itemError=function(g){o.onError!==void 0&&o.onError(g)},this.resolveURL=function(g){return g=g.normalize("NFC"),d?d(g):g},this.setURLModifier=function(g){return d=g,this},this.addHandler=function(g,_){return p.push(g,_),this},this.removeHandler=function(g){const _=p.indexOf(g);return _!==-1&&p.splice(_,2),this},this.getHandler=function(g){for(let _=0,v=p.length;_<v;_+=2){const x=p[_],b=p[_+1];if(x.global&&(x.lastIndex=0),x.test(g))return b}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){return this._abortController||(this._abortController=new AbortController),this._abortController}}const aT=new iT;class tg{constructor(t){this.manager=t!==void 0?t:aT,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(t,e){const a=this;return new Promise(function(o,l){a.load(t,o,e,l)})}parse(){}setCrossOrigin(t){return this.crossOrigin=t,this}setWithCredentials(t){return this.withCredentials=t,this}setPath(t){return this.path=t,this}setResourcePath(t){return this.resourcePath=t,this}setRequestHeader(t){return this.requestHeader=t,this}abort(){return this}}tg.DEFAULT_MATERIAL_NAME="__DEFAULT";const Mo=new WeakMap;class sT extends tg{constructor(t){super(t)}load(t,e,a,o){this.path!==void 0&&(t=this.path+t),t=this.manager.resolveURL(t);const l=this,u=pp.get(`image:${t}`);if(u!==void 0){if(u.complete===!0)l.manager.itemStart(t),setTimeout(function(){e&&e(u),l.manager.itemEnd(t)},0);else{let _=Mo.get(u);_===void 0&&(_=[],Mo.set(u,_)),_.push({onLoad:e,onError:o})}return u}const h=cc("img");function d(){g(),e&&e(this);const _=Mo.get(this)||[];for(let v=0;v<_.length;v++){const x=_[v];x.onLoad&&x.onLoad(this)}Mo.delete(this),l.manager.itemEnd(t)}function p(_){g(),o&&o(_),pp.remove(`image:${t}`);const v=Mo.get(this)||[];for(let x=0;x<v.length;x++){const b=v[x];b.onError&&b.onError(_)}Mo.delete(this),l.manager.itemError(t),l.manager.itemEnd(t)}function g(){h.removeEventListener("load",d,!1),h.removeEventListener("error",p,!1)}return h.addEventListener("load",d,!1),h.addEventListener("error",p,!1),t.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(h.crossOrigin=this.crossOrigin),pp.add(`image:${t}`,h),l.manager.itemStart(t),h.src=t,h}}class rT extends tg{constructor(t){super(t)}load(t,e,a,o){const l=new Yn,u=new sT(this.manager);return u.setCrossOrigin(this.crossOrigin),u.setPath(this.path),u.load(t,function(h){l.image=h,l.needsUpdate=!0,e!==void 0&&e(l)},a,o),l}}class eg extends Cn{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new pe(t),this.intensity=e}dispose(){this.dispatchEvent({type:"dispose"})}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){const e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,e}}class oT extends eg{constructor(t,e,a){super(t,a),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Cn.DEFAULT_UP),this.updateMatrix(),this.groundColor=new pe(e)}copy(t,e){return super.copy(t,e),this.groundColor.copy(t.groundColor),this}toJSON(t){const e=super.toJSON(t);return e.object.groundColor=this.groundColor.getHex(),e}}const mp=new en,Wx=new q,qx=new q;class mS{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ut(512,512),this.mapType=Di,this.map=null,this.mapPass=null,this.matrix=new en,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Jm,this._frameExtents=new Ut(1,1),this._viewportCount=1,this._viewports=[new pn(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){const e=this.camera,a=this.matrix;Wx.setFromMatrixPosition(t.matrixWorld),e.position.copy(Wx),qx.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(qx),e.updateMatrixWorld(),mp.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(mp,e.coordinateSystem,e.reversedDepth),e.coordinateSystem===lc||e.reversedDepth?a.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):a.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),a.multiply(mp)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.autoUpdate=t.autoUpdate,this.needsUpdate=t.needsUpdate,this.normalBias=t.normalBias,this.blurSamples=t.blurSamples,this.mapSize.copy(t.mapSize),this.biasNode=t.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){const t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}}const Ju=new q,Qu=new Xo,la=new q;class gS extends Cn{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new en,this.projectionMatrix=new en,this.projectionMatrixInverse=new en,this.coordinateSystem=da,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorld.decompose(Ju,Qu,la),la.x===1&&la.y===1&&la.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Ju,Qu,la.set(1,1,1)).invert()}updateWorldMatrix(t,e,a=!1){super.updateWorldMatrix(t,e,a),this.matrixWorld.decompose(Ju,Qu,la),la.x===1&&la.y===1&&la.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(Ju,Qu,la.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}}const Ns=new q,Yx=new Ut,Zx=new Ut;class Ci extends gS{constructor(t=50,e=1,a=.1,o=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=a,this.far=o,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){const e=.5*this.getFilmHeight()/t;this.fov=pm*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){const t=Math.tan(Hd*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return pm*2*Math.atan(Math.tan(Hd*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,a){Ns.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(Ns.x,Ns.y).multiplyScalar(-t/Ns.z),Ns.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),a.set(Ns.x,Ns.y).multiplyScalar(-t/Ns.z)}getViewSize(t,e){return this.getViewBounds(t,Yx,Zx),e.subVectors(Zx,Yx)}setViewOffset(t,e,a,o,l,u){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=a,this.view.offsetY=o,this.view.width=l,this.view.height=u,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=this.near;let e=t*Math.tan(Hd*.5*this.fov)/this.zoom,a=2*e,o=this.aspect*a,l=-.5*o;const u=this.view;if(this.view!==null&&this.view.enabled){const d=u.fullWidth,p=u.fullHeight;l+=u.offsetX*o/d,e-=u.offsetY*a/p,o*=u.width/d,a*=u.height/p}const h=this.filmOffset;h!==0&&(l+=t*h/this.getFilmWidth()),this.projectionMatrix.makePerspective(l,l+o,e,e-a,t,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}}class lT extends mS{constructor(){super(new Ci(90,1,.5,500)),this.isPointLightShadow=!0}}class cT extends eg{constructor(t,e,a=0,o=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=a,this.decay=o,this.shadow=new lT}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}toJSON(t){const e=super.toJSON(t);return e.object.distance=this.distance,e.object.decay=this.decay,e.object.shadow=this.shadow.toJSON(),e}}class ng extends gS{constructor(t=-1,e=1,a=1,o=-1,l=.1,u=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=a,this.bottom=o,this.near=l,this.far=u,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,a,o,l,u){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=a,this.view.offsetY=o,this.view.width=l,this.view.height=u,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),a=(this.right+this.left)/2,o=(this.top+this.bottom)/2;let l=a-t,u=a+t,h=o+e,d=o-e;if(this.view!==null&&this.view.enabled){const p=(this.right-this.left)/this.view.fullWidth/this.zoom,g=(this.top-this.bottom)/this.view.fullHeight/this.zoom;l+=p*this.view.offsetX,u=l+p*this.view.width,h-=g*this.view.offsetY,d=h-g*this.view.height}this.projectionMatrix.makeOrthographic(l,u,h,d,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}}class uT extends mS{constructor(){super(new ng(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class Kx extends eg{constructor(t,e){super(t,e),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Cn.DEFAULT_UP),this.updateMatrix(),this.target=new Cn,this.shadow=new uT}dispose(){super.dispose(),this.shadow.dispose()}copy(t){return super.copy(t),this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}toJSON(t){const e=super.toJSON(t);return e.object.shadow=this.shadow.toJSON(),e.object.target=this.target.uuid,e}}const bo=-90,Eo=1;class fT extends Cn{constructor(t,e,a){super(),this.type="CubeCamera",this.renderTarget=a,this.coordinateSystem=null,this.activeMipmapLevel=0;const o=new Ci(bo,Eo,t,e);o.layers=this.layers,this.add(o);const l=new Ci(bo,Eo,t,e);l.layers=this.layers,this.add(l);const u=new Ci(bo,Eo,t,e);u.layers=this.layers,this.add(u);const h=new Ci(bo,Eo,t,e);h.layers=this.layers,this.add(h);const d=new Ci(bo,Eo,t,e);d.layers=this.layers,this.add(d);const p=new Ci(bo,Eo,t,e);p.layers=this.layers,this.add(p)}updateCoordinateSystem(){const t=this.coordinateSystem,e=this.children.concat(),[a,o,l,u,h,d]=e;for(const p of e)this.remove(p);if(t===da)a.up.set(0,1,0),a.lookAt(1,0,0),o.up.set(0,1,0),o.lookAt(-1,0,0),l.up.set(0,0,-1),l.lookAt(0,1,0),u.up.set(0,0,1),u.lookAt(0,-1,0),h.up.set(0,1,0),h.lookAt(0,0,1),d.up.set(0,1,0),d.lookAt(0,0,-1);else if(t===lc)a.up.set(0,-1,0),a.lookAt(-1,0,0),o.up.set(0,-1,0),o.lookAt(1,0,0),l.up.set(0,0,1),l.lookAt(0,1,0),u.up.set(0,0,-1),u.lookAt(0,-1,0),h.up.set(0,-1,0),h.lookAt(0,0,1),d.up.set(0,-1,0),d.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(const p of e)this.add(p),p.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();const{renderTarget:a,activeMipmapLevel:o}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());const[l,u,h,d,p,g]=this.children,_=t.getRenderTarget(),v=t.getActiveCubeFace(),x=t.getActiveMipmapLevel(),b=t.xr.enabled;t.xr.enabled=!1;const C=a.texture.generateMipmaps;a.texture.generateMipmaps=!1;let M=!1;t.isWebGLRenderer===!0?M=t.state.buffers.depth.getReversed():M=t.reversedDepthBuffer,t.setRenderTarget(a,0,o),M&&t.autoClear===!1&&t.clearDepth(),t.render(e,l),t.setRenderTarget(a,1,o),M&&t.autoClear===!1&&t.clearDepth(),t.render(e,u),t.setRenderTarget(a,2,o),M&&t.autoClear===!1&&t.clearDepth(),t.render(e,h),t.setRenderTarget(a,3,o),M&&t.autoClear===!1&&t.clearDepth(),t.render(e,d),t.setRenderTarget(a,4,o),M&&t.autoClear===!1&&t.clearDepth(),t.render(e,p),a.texture.generateMipmaps=C,t.setRenderTarget(a,5,o),M&&t.autoClear===!1&&t.clearDepth(),t.render(e,g),t.setRenderTarget(_,v,x),t.xr.enabled=b,a.texture.needsPMREMUpdate=!0}}class hT extends Ci{constructor(t=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=t}}const Jx=new en;class dT{constructor(t,e,a=0,o=1/0){this.ray=new $y(t,e),this.near=a,this.far=o,this.camera=null,this.layers=new Ym,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(t,e){this.ray.set(t,e)}setFromCamera(t,e){e.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(t.x,t.y,.5).unproject(e).sub(this.ray.origin).normalize(),this.camera=e):e.isOrthographicCamera?(this.ray.origin.set(t.x,t.y,e.projectionMatrix.elements[14]).unproject(e),this.ray.direction.set(0,0,-1).transformDirection(e.matrixWorld),this.camera=e):Oe("Raycaster: Unsupported camera type: "+e.type)}setFromXRController(t){return Jx.identity().extractRotation(t.matrixWorld),this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(Jx),this}intersectObject(t,e=!0,a=[]){return _m(t,this,a,e),a.sort(Qx),a}intersectObjects(t,e=!0,a=[]){for(let o=0,l=t.length;o<l;o++)_m(t[o],this,a,e);return a.sort(Qx),a}}function Qx(s,t){return s.distance-t.distance}function _m(s,t,e,a){let o=!0;if(s.layers.test(t.layers)&&s.raycast(t,e)===!1&&(o=!1),o===!0&&a===!0){const l=s.children;for(let u=0,h=l.length;u<h;u++)_m(l[u],t,e,!0)}}const hg=class hg{constructor(t,e,a,o){this.elements=[1,0,0,1],t!==void 0&&this.set(t,e,a,o)}identity(){return this.set(1,0,0,1),this}fromArray(t,e=0){for(let a=0;a<4;a++)this.elements[a]=t[a+e];return this}set(t,e,a,o){const l=this.elements;return l[0]=t,l[2]=e,l[1]=a,l[3]=o,this}};hg.prototype.isMatrix2=!0;let $x=hg;function jx(s,t,e,a){const o=pT(a);switch(e){case ky:return s*t;case Hm:return s*t/o.components*o.byteLength;case Gm:return s*t/o.components*o.byteLength;case Sr:return s*t*2/o.components*o.byteLength;case Vm:return s*t*2/o.components*o.byteLength;case Xy:return s*t*3/o.components*o.byteLength;case ta:return s*t*4/o.components*o.byteLength;case km:return s*t*4/o.components*o.byteLength;case ef:case nf:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case af:case sf:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case zp:case Hp:return Math.max(s,16)*Math.max(t,8)/4;case Ip:case Fp:return Math.max(s,8)*Math.max(t,8)/2;case Gp:case Vp:case Xp:case Wp:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case kp:case uf:case qp:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case Yp:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case Zp:return Math.floor((s+4)/5)*Math.floor((t+3)/4)*16;case Kp:return Math.floor((s+4)/5)*Math.floor((t+4)/5)*16;case Jp:return Math.floor((s+5)/6)*Math.floor((t+4)/5)*16;case Qp:return Math.floor((s+5)/6)*Math.floor((t+5)/6)*16;case $p:return Math.floor((s+7)/8)*Math.floor((t+4)/5)*16;case jp:return Math.floor((s+7)/8)*Math.floor((t+5)/6)*16;case tm:return Math.floor((s+7)/8)*Math.floor((t+7)/8)*16;case em:return Math.floor((s+9)/10)*Math.floor((t+4)/5)*16;case nm:return Math.floor((s+9)/10)*Math.floor((t+5)/6)*16;case im:return Math.floor((s+9)/10)*Math.floor((t+7)/8)*16;case am:return Math.floor((s+9)/10)*Math.floor((t+9)/10)*16;case sm:return Math.floor((s+11)/12)*Math.floor((t+9)/10)*16;case rm:return Math.floor((s+11)/12)*Math.floor((t+11)/12)*16;case om:case lm:case cm:return Math.ceil(s/4)*Math.ceil(t/4)*16;case um:case fm:return Math.ceil(s/4)*Math.ceil(t/4)*8;case ff:case hm:return Math.ceil(s/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function pT(s){switch(s){case Di:case Fy:return{byteLength:1,components:1};case rc:case Hy:case $a:return{byteLength:2,components:1};case zm:case Fm:return{byteLength:2,components:4};case ga:case Im:case ji:return{byteLength:4,components:1};case Gy:case Vy:return{byteLength:4,components:3}}throw new Error(`THREE.TextureUtils: Unknown texture type ${s}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Om}}));typeof window<"u"&&(window.__THREE__?ge("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Om);function vS(){let s=null,t=!1,e=null,a=null;function o(l,u){e(l,u),a=s.requestAnimationFrame(o)}return{start:function(){t!==!0&&e!==null&&s!==null&&(a=s.requestAnimationFrame(o),t=!0)},stop:function(){s!==null&&s.cancelAnimationFrame(a),t=!1},setAnimationLoop:function(l){e=l},setContext:function(l){s=l}}}function mT(s){const t=new WeakMap;function e(h,d){const p=h.array,g=h.usage,_=p.byteLength,v=s.createBuffer();s.bindBuffer(d,v),s.bufferData(d,p,g),h.onUploadCallback();let x;if(p instanceof Float32Array)x=s.FLOAT;else if(typeof Float16Array<"u"&&p instanceof Float16Array)x=s.HALF_FLOAT;else if(p instanceof Uint16Array)h.isFloat16BufferAttribute?x=s.HALF_FLOAT:x=s.UNSIGNED_SHORT;else if(p instanceof Int16Array)x=s.SHORT;else if(p instanceof Uint32Array)x=s.UNSIGNED_INT;else if(p instanceof Int32Array)x=s.INT;else if(p instanceof Int8Array)x=s.BYTE;else if(p instanceof Uint8Array)x=s.UNSIGNED_BYTE;else if(p instanceof Uint8ClampedArray)x=s.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+p);return{buffer:v,type:x,bytesPerElement:p.BYTES_PER_ELEMENT,version:h.version,size:_}}function a(h,d,p){const g=d.array,_=d.updateRanges;if(s.bindBuffer(p,h),_.length===0)s.bufferSubData(p,0,g);else{_.sort((x,b)=>x.start-b.start);let v=0;for(let x=1;x<_.length;x++){const b=_[v],C=_[x];C.start<=b.start+b.count+1?b.count=Math.max(b.count,C.start+C.count-b.start):(++v,_[v]=C)}_.length=v+1;for(let x=0,b=_.length;x<b;x++){const C=_[x];s.bufferSubData(p,C.start*g.BYTES_PER_ELEMENT,g,C.start,C.count)}d.clearUpdateRanges()}d.onUploadCallback()}function o(h){return h.isInterleavedBufferAttribute&&(h=h.data),t.get(h)}function l(h){h.isInterleavedBufferAttribute&&(h=h.data);const d=t.get(h);d&&(s.deleteBuffer(d.buffer),t.delete(h))}function u(h,d){if(h.isInterleavedBufferAttribute&&(h=h.data),h.isGLBufferAttribute){const g=t.get(h);(!g||g.version<h.version)&&t.set(h,{buffer:h.buffer,type:h.type,bytesPerElement:h.elementSize,version:h.version});return}const p=t.get(h);if(p===void 0)t.set(h,e(h,d));else if(p.version<h.version){if(p.size!==h.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");a(p.buffer,h,d),p.version=h.version}}return{get:o,remove:l,update:u}}var gT=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,vT=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,_T=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,xT=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,yT=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,ST=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,MT=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,bT=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,ET=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,TT=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,AT=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,wT=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,RT=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,CT=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,DT=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,UT=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,LT=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,NT=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,OT=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,PT=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,BT=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,IT=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,zT=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,FT=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,HT=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,GT=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,VT=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,kT=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,XT=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,WT=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,qT="gl_FragColor = linearToOutputTexel( gl_FragColor );",YT=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,ZT=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,KT=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,JT=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,QT=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,$T=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,jT=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,tA=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,eA=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,nA=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,iA=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,aA=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,sA=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,rA=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,oA=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,lA=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,cA=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,uA=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,fA=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,hA=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,dA=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,pA=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
		vec3 iridescenceFresnelDielectric;
		vec3 iridescenceFresnelMetallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
vec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 dfgV = texture2D( dfgLUT, vec2( material.roughness, dotNV ) ).rg;
	vec2 dfgL = texture2D( dfgLUT, vec2( material.roughness, dotNL ) ).rg;
	vec3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;
	vec3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;
	float Ess_V = dfgV.x + dfgV.y;
	float Ess_L = dfgL.x + dfgL.y;
	float Ems_V = 1.0 - Ess_V;
	float Ems_L = 1.0 - Ess_L;
	vec3 Favg = material.specularColorBlended + ( 1.0 - material.specularColorBlended ) * 0.047619;
	vec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg + EPSILON );
	float compensationFactor = Ems_V * Ems_L;
	vec3 multiScatter = Fms * compensationFactor;
	return singleScatter + multiScatter;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnelDielectric, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceFresnelMetallic, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,mA=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( material.iridescenceFresnelDielectric, material.iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,gA=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,vA=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,_A=`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,xA=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,yA=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,SA=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,MA=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,bA=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,EA=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,TA=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,AA=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,wA=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,RA=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,CA=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,DA=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,UA=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,LA=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,NA=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,OA=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,PA=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,BA=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,IA=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,zA=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,FA=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,HA=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,GA=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,VA=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,kA=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,XA=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,WA=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,qA=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,YA=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,ZA=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,KA=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,JA=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,QA=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,$A=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,jA=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,t2=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,e2=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,n2=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,i2=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,a2=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,s2=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,r2=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,o2=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,l2=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,c2=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,u2=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,f2=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,h2=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,d2=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,p2=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,m2=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const g2=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,v2=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,_2=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,x2=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,y2=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,S2=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,M2=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,b2=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,E2=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,T2=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,A2=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,w2=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,R2=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,C2=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,D2=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,U2=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,L2=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,N2=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,O2=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,P2=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,B2=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,I2=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,z2=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,F2=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,H2=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,G2=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,V2=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,k2=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,X2=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,W2=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,q2=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Y2=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Z2=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,K2=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Ae={alphahash_fragment:gT,alphahash_pars_fragment:vT,alphamap_fragment:_T,alphamap_pars_fragment:xT,alphatest_fragment:yT,alphatest_pars_fragment:ST,aomap_fragment:MT,aomap_pars_fragment:bT,batching_pars_vertex:ET,batching_vertex:TT,begin_vertex:AT,beginnormal_vertex:wT,bsdfs:RT,iridescence_fragment:CT,bumpmap_pars_fragment:DT,clipping_planes_fragment:UT,clipping_planes_pars_fragment:LT,clipping_planes_pars_vertex:NT,clipping_planes_vertex:OT,color_fragment:PT,color_pars_fragment:BT,color_pars_vertex:IT,color_vertex:zT,common:FT,cube_uv_reflection_fragment:HT,defaultnormal_vertex:GT,displacementmap_pars_vertex:VT,displacementmap_vertex:kT,emissivemap_fragment:XT,emissivemap_pars_fragment:WT,colorspace_fragment:qT,colorspace_pars_fragment:YT,envmap_fragment:ZT,envmap_common_pars_fragment:KT,envmap_pars_fragment:JT,envmap_pars_vertex:QT,envmap_physical_pars_fragment:lA,envmap_vertex:$T,fog_vertex:jT,fog_pars_vertex:tA,fog_fragment:eA,fog_pars_fragment:nA,gradientmap_pars_fragment:iA,lightmap_pars_fragment:aA,lights_lambert_fragment:sA,lights_lambert_pars_fragment:rA,lights_pars_begin:oA,lights_toon_fragment:cA,lights_toon_pars_fragment:uA,lights_phong_fragment:fA,lights_phong_pars_fragment:hA,lights_physical_fragment:dA,lights_physical_pars_fragment:pA,lights_fragment_begin:mA,lights_fragment_maps:gA,lights_fragment_end:vA,lightprobes_pars_fragment:_A,logdepthbuf_fragment:xA,logdepthbuf_pars_fragment:yA,logdepthbuf_pars_vertex:SA,logdepthbuf_vertex:MA,map_fragment:bA,map_pars_fragment:EA,map_particle_fragment:TA,map_particle_pars_fragment:AA,metalnessmap_fragment:wA,metalnessmap_pars_fragment:RA,morphinstance_vertex:CA,morphcolor_vertex:DA,morphnormal_vertex:UA,morphtarget_pars_vertex:LA,morphtarget_vertex:NA,normal_fragment_begin:OA,normal_fragment_maps:PA,normal_pars_fragment:BA,normal_pars_vertex:IA,normal_vertex:zA,normalmap_pars_fragment:FA,clearcoat_normal_fragment_begin:HA,clearcoat_normal_fragment_maps:GA,clearcoat_pars_fragment:VA,iridescence_pars_fragment:kA,opaque_fragment:XA,packing:WA,premultiplied_alpha_fragment:qA,project_vertex:YA,dithering_fragment:ZA,dithering_pars_fragment:KA,roughnessmap_fragment:JA,roughnessmap_pars_fragment:QA,shadowmap_pars_fragment:$A,shadowmap_pars_vertex:jA,shadowmap_vertex:t2,shadowmask_pars_fragment:e2,skinbase_vertex:n2,skinning_pars_vertex:i2,skinning_vertex:a2,skinnormal_vertex:s2,specularmap_fragment:r2,specularmap_pars_fragment:o2,tonemapping_fragment:l2,tonemapping_pars_fragment:c2,transmission_fragment:u2,transmission_pars_fragment:f2,uv_pars_fragment:h2,uv_pars_vertex:d2,uv_vertex:p2,worldpos_vertex:m2,background_vert:g2,background_frag:v2,backgroundCube_vert:_2,backgroundCube_frag:x2,cube_vert:y2,cube_frag:S2,depth_vert:M2,depth_frag:b2,distance_vert:E2,distance_frag:T2,equirect_vert:A2,equirect_frag:w2,linedashed_vert:R2,linedashed_frag:C2,meshbasic_vert:D2,meshbasic_frag:U2,meshlambert_vert:L2,meshlambert_frag:N2,meshmatcap_vert:O2,meshmatcap_frag:P2,meshnormal_vert:B2,meshnormal_frag:I2,meshphong_vert:z2,meshphong_frag:F2,meshphysical_vert:H2,meshphysical_frag:G2,meshtoon_vert:V2,meshtoon_frag:k2,points_vert:X2,points_frag:W2,shadow_vert:q2,shadow_frag:Y2,sprite_vert:Z2,sprite_frag:K2},Wt={common:{diffuse:{value:new pe(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Se},alphaMap:{value:null},alphaMapTransform:{value:new Se},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Se}},envmap:{envMap:{value:null},envMapRotation:{value:new Se},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Se}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Se}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Se},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Se},normalScale:{value:new Ut(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Se},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Se}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Se}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Se}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new pe(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new q},probesMax:{value:new q},probesResolution:{value:new q}},points:{diffuse:{value:new pe(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Se},alphaTest:{value:0},uvTransform:{value:new Se}},sprite:{diffuse:{value:new pe(16777215)},opacity:{value:1},center:{value:new Ut(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Se},alphaMap:{value:null},alphaMapTransform:{value:new Se},alphaTest:{value:0}}},ua={basic:{uniforms:si([Wt.common,Wt.specularmap,Wt.envmap,Wt.aomap,Wt.lightmap,Wt.fog]),vertexShader:Ae.meshbasic_vert,fragmentShader:Ae.meshbasic_frag},lambert:{uniforms:si([Wt.common,Wt.specularmap,Wt.envmap,Wt.aomap,Wt.lightmap,Wt.emissivemap,Wt.bumpmap,Wt.normalmap,Wt.displacementmap,Wt.fog,Wt.lights,{emissive:{value:new pe(0)},envMapIntensity:{value:1}}]),vertexShader:Ae.meshlambert_vert,fragmentShader:Ae.meshlambert_frag},phong:{uniforms:si([Wt.common,Wt.specularmap,Wt.envmap,Wt.aomap,Wt.lightmap,Wt.emissivemap,Wt.bumpmap,Wt.normalmap,Wt.displacementmap,Wt.fog,Wt.lights,{emissive:{value:new pe(0)},specular:{value:new pe(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:Ae.meshphong_vert,fragmentShader:Ae.meshphong_frag},standard:{uniforms:si([Wt.common,Wt.envmap,Wt.aomap,Wt.lightmap,Wt.emissivemap,Wt.bumpmap,Wt.normalmap,Wt.displacementmap,Wt.roughnessmap,Wt.metalnessmap,Wt.fog,Wt.lights,{emissive:{value:new pe(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ae.meshphysical_vert,fragmentShader:Ae.meshphysical_frag},toon:{uniforms:si([Wt.common,Wt.aomap,Wt.lightmap,Wt.emissivemap,Wt.bumpmap,Wt.normalmap,Wt.displacementmap,Wt.gradientmap,Wt.fog,Wt.lights,{emissive:{value:new pe(0)}}]),vertexShader:Ae.meshtoon_vert,fragmentShader:Ae.meshtoon_frag},matcap:{uniforms:si([Wt.common,Wt.bumpmap,Wt.normalmap,Wt.displacementmap,Wt.fog,{matcap:{value:null}}]),vertexShader:Ae.meshmatcap_vert,fragmentShader:Ae.meshmatcap_frag},points:{uniforms:si([Wt.points,Wt.fog]),vertexShader:Ae.points_vert,fragmentShader:Ae.points_frag},dashed:{uniforms:si([Wt.common,Wt.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ae.linedashed_vert,fragmentShader:Ae.linedashed_frag},depth:{uniforms:si([Wt.common,Wt.displacementmap]),vertexShader:Ae.depth_vert,fragmentShader:Ae.depth_frag},normal:{uniforms:si([Wt.common,Wt.bumpmap,Wt.normalmap,Wt.displacementmap,{opacity:{value:1}}]),vertexShader:Ae.meshnormal_vert,fragmentShader:Ae.meshnormal_frag},sprite:{uniforms:si([Wt.sprite,Wt.fog]),vertexShader:Ae.sprite_vert,fragmentShader:Ae.sprite_frag},background:{uniforms:{uvTransform:{value:new Se},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ae.background_vert,fragmentShader:Ae.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Se}},vertexShader:Ae.backgroundCube_vert,fragmentShader:Ae.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ae.cube_vert,fragmentShader:Ae.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ae.equirect_vert,fragmentShader:Ae.equirect_frag},distance:{uniforms:si([Wt.common,Wt.displacementmap,{referencePosition:{value:new q},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ae.distance_vert,fragmentShader:Ae.distance_frag},shadow:{uniforms:si([Wt.lights,Wt.fog,{color:{value:new pe(0)},opacity:{value:1}}]),vertexShader:Ae.shadow_vert,fragmentShader:Ae.shadow_frag}};ua.physical={uniforms:si([ua.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Se},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Se},clearcoatNormalScale:{value:new Ut(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Se},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Se},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Se},sheen:{value:0},sheenColor:{value:new pe(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Se},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Se},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Se},transmissionSamplerSize:{value:new Ut},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Se},attenuationDistance:{value:0},attenuationColor:{value:new pe(0)},specularColor:{value:new pe(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Se},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Se},anisotropyVector:{value:new Ut},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Se}}]),vertexShader:Ae.meshphysical_vert,fragmentShader:Ae.meshphysical_frag};const $u={r:0,b:0,g:0},J2=new en,_S=new Se;_S.set(-1,0,0,0,1,0,0,0,1);function Q2(s,t,e,a,o,l){const u=new pe(0);let h=o===!0?0:1,d,p,g=null,_=0,v=null;function x(I){let D=I.isScene===!0?I.background:null;if(D&&D.isTexture){const A=I.backgroundBlurriness>0;D=t.get(D,A)}return D}function b(I){let D=!1;const A=x(I);A===null?M(u,h):A&&A.isColor&&(M(A,1),D=!0);const O=s.xr.getEnvironmentBlendMode();O==="additive"?e.buffers.color.setClear(0,0,0,1,l):O==="alpha-blend"&&e.buffers.color.setClear(0,0,0,0,l),(s.autoClear||D)&&(e.buffers.depth.setTest(!0),e.buffers.depth.setMask(!0),e.buffers.color.setMask(!0),s.clear(s.autoClearColor,s.autoClearDepth,s.autoClearStencil))}function C(I,D){const A=x(D);A&&(A.isCubeTexture||A.mapping===bf)?(p===void 0&&(p=new Ge(new Qa(1,1,1),new Ui({name:"BackgroundCubeMaterial",uniforms:ko(ua.backgroundCube.uniforms),vertexShader:ua.backgroundCube.vertexShader,fragmentShader:ua.backgroundCube.fragmentShader,side:ni,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),p.geometry.deleteAttribute("normal"),p.geometry.deleteAttribute("uv"),p.onBeforeRender=function(O,U,z){this.matrixWorld.copyPosition(z.matrixWorld)},Object.defineProperty(p.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),a.update(p)),p.material.uniforms.envMap.value=A,p.material.uniforms.backgroundBlurriness.value=D.backgroundBlurriness,p.material.uniforms.backgroundIntensity.value=D.backgroundIntensity,p.material.uniforms.backgroundRotation.value.setFromMatrix4(J2.makeRotationFromEuler(D.backgroundRotation)).transpose(),A.isCubeTexture&&A.isRenderTargetTexture===!1&&p.material.uniforms.backgroundRotation.value.premultiply(_S),p.material.toneMapped=Ie.getTransfer(A.colorSpace)!==Je,(g!==A||_!==A.version||v!==s.toneMapping)&&(p.material.needsUpdate=!0,g=A,_=A.version,v=s.toneMapping),p.layers.enableAll(),I.unshift(p,p.geometry,p.material,0,0,null)):A&&A.isTexture&&(d===void 0&&(d=new Ge(new Vo(2,2),new Ui({name:"BackgroundMaterial",uniforms:ko(ua.background.uniforms),vertexShader:ua.background.vertexShader,fragmentShader:ua.background.fragmentShader,side:Fs,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),d.geometry.deleteAttribute("normal"),Object.defineProperty(d.material,"map",{get:function(){return this.uniforms.t2D.value}}),a.update(d)),d.material.uniforms.t2D.value=A,d.material.uniforms.backgroundIntensity.value=D.backgroundIntensity,d.material.toneMapped=Ie.getTransfer(A.colorSpace)!==Je,A.matrixAutoUpdate===!0&&A.updateMatrix(),d.material.uniforms.uvTransform.value.copy(A.matrix),(g!==A||_!==A.version||v!==s.toneMapping)&&(d.material.needsUpdate=!0,g=A,_=A.version,v=s.toneMapping),d.layers.enableAll(),I.unshift(d,d.geometry,d.material,0,0,null))}function M(I,D){I.getRGB($u,pS(s)),e.buffers.color.setClear($u.r,$u.g,$u.b,D,l)}function y(){p!==void 0&&(p.geometry.dispose(),p.material.dispose(),p=void 0),d!==void 0&&(d.geometry.dispose(),d.material.dispose(),d=void 0)}return{getClearColor:function(){return u},setClearColor:function(I,D=1){u.set(I),h=D,M(u,h)},getClearAlpha:function(){return h},setClearAlpha:function(I){h=I,M(u,h)},render:b,addToRenderList:C,dispose:y}}function $2(s,t){const e=s.getParameter(s.MAX_VERTEX_ATTRIBS),a={},o=v(null);let l=o,u=!1;function h(H,K,ft,dt,J){let F=!1;const N=_(H,dt,ft,K);l!==N&&(l=N,p(l.object)),F=x(H,dt,ft,J),F&&b(H,dt,ft,J),J!==null&&t.update(J,s.ELEMENT_ARRAY_BUFFER),(F||u)&&(u=!1,A(H,K,ft,dt),J!==null&&s.bindBuffer(s.ELEMENT_ARRAY_BUFFER,t.get(J).buffer))}function d(){return s.createVertexArray()}function p(H){return s.bindVertexArray(H)}function g(H){return s.deleteVertexArray(H)}function _(H,K,ft,dt){const J=dt.wireframe===!0;let F=a[K.id];F===void 0&&(F={},a[K.id]=F);const N=H.isInstancedMesh===!0?H.id:0;let V=F[N];V===void 0&&(V={},F[N]=V);let nt=V[ft.id];nt===void 0&&(nt={},V[ft.id]=nt);let mt=nt[J];return mt===void 0&&(mt=v(d()),nt[J]=mt),mt}function v(H){const K=[],ft=[],dt=[];for(let J=0;J<e;J++)K[J]=0,ft[J]=0,dt[J]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:K,enabledAttributes:ft,attributeDivisors:dt,object:H,attributes:{},index:null}}function x(H,K,ft,dt){const J=l.attributes,F=K.attributes;let N=0;const V=ft.getAttributes();for(const nt in V)if(V[nt].location>=0){const L=J[nt];let X=F[nt];if(X===void 0&&(nt==="instanceMatrix"&&H.instanceMatrix&&(X=H.instanceMatrix),nt==="instanceColor"&&H.instanceColor&&(X=H.instanceColor)),L===void 0||L.attribute!==X||X&&L.data!==X.data)return!0;N++}return l.attributesNum!==N||l.index!==dt}function b(H,K,ft,dt){const J={},F=K.attributes;let N=0;const V=ft.getAttributes();for(const nt in V)if(V[nt].location>=0){let L=F[nt];L===void 0&&(nt==="instanceMatrix"&&H.instanceMatrix&&(L=H.instanceMatrix),nt==="instanceColor"&&H.instanceColor&&(L=H.instanceColor));const X={};X.attribute=L,L&&L.data&&(X.data=L.data),J[nt]=X,N++}l.attributes=J,l.attributesNum=N,l.index=dt}function C(){const H=l.newAttributes;for(let K=0,ft=H.length;K<ft;K++)H[K]=0}function M(H){y(H,0)}function y(H,K){const ft=l.newAttributes,dt=l.enabledAttributes,J=l.attributeDivisors;ft[H]=1,dt[H]===0&&(s.enableVertexAttribArray(H),dt[H]=1),J[H]!==K&&(s.vertexAttribDivisor(H,K),J[H]=K)}function I(){const H=l.newAttributes,K=l.enabledAttributes;for(let ft=0,dt=K.length;ft<dt;ft++)K[ft]!==H[ft]&&(s.disableVertexAttribArray(ft),K[ft]=0)}function D(H,K,ft,dt,J,F,N){N===!0?s.vertexAttribIPointer(H,K,ft,J,F):s.vertexAttribPointer(H,K,ft,dt,J,F)}function A(H,K,ft,dt){C();const J=dt.attributes,F=ft.getAttributes(),N=K.defaultAttributeValues;for(const V in F){const nt=F[V];if(nt.location>=0){let mt=J[V];if(mt===void 0&&(V==="instanceMatrix"&&H.instanceMatrix&&(mt=H.instanceMatrix),V==="instanceColor"&&H.instanceColor&&(mt=H.instanceColor)),mt!==void 0){const L=mt.normalized,X=mt.itemSize,_t=t.get(mt);if(_t===void 0)continue;const Ct=_t.buffer,Lt=_t.type,et=_t.bytesPerElement,Mt=Lt===s.INT||Lt===s.UNSIGNED_INT||mt.gpuType===Im;if(mt.isInterleavedBufferAttribute){const Et=mt.data,zt=Et.stride,oe=mt.offset;if(Et.isInstancedInterleavedBuffer){for(let ae=0;ae<nt.locationSize;ae++)y(nt.location+ae,Et.meshPerAttribute);H.isInstancedMesh!==!0&&dt._maxInstanceCount===void 0&&(dt._maxInstanceCount=Et.meshPerAttribute*Et.count)}else for(let ae=0;ae<nt.locationSize;ae++)M(nt.location+ae);s.bindBuffer(s.ARRAY_BUFFER,Ct);for(let ae=0;ae<nt.locationSize;ae++)D(nt.location+ae,X/nt.locationSize,Lt,L,zt*et,(oe+X/nt.locationSize*ae)*et,Mt)}else{if(mt.isInstancedBufferAttribute){for(let Et=0;Et<nt.locationSize;Et++)y(nt.location+Et,mt.meshPerAttribute);H.isInstancedMesh!==!0&&dt._maxInstanceCount===void 0&&(dt._maxInstanceCount=mt.meshPerAttribute*mt.count)}else for(let Et=0;Et<nt.locationSize;Et++)M(nt.location+Et);s.bindBuffer(s.ARRAY_BUFFER,Ct);for(let Et=0;Et<nt.locationSize;Et++)D(nt.location+Et,X/nt.locationSize,Lt,L,X*et,X/nt.locationSize*Et*et,Mt)}}else if(N!==void 0){const L=N[V];if(L!==void 0)switch(L.length){case 2:s.vertexAttrib2fv(nt.location,L);break;case 3:s.vertexAttrib3fv(nt.location,L);break;case 4:s.vertexAttrib4fv(nt.location,L);break;default:s.vertexAttrib1fv(nt.location,L)}}}}I()}function O(){P();for(const H in a){const K=a[H];for(const ft in K){const dt=K[ft];for(const J in dt){const F=dt[J];for(const N in F)g(F[N].object),delete F[N];delete dt[J]}}delete a[H]}}function U(H){if(a[H.id]===void 0)return;const K=a[H.id];for(const ft in K){const dt=K[ft];for(const J in dt){const F=dt[J];for(const N in F)g(F[N].object),delete F[N];delete dt[J]}}delete a[H.id]}function z(H){for(const K in a){const ft=a[K];for(const dt in ft){const J=ft[dt];if(J[H.id]===void 0)continue;const F=J[H.id];for(const N in F)g(F[N].object),delete F[N];delete J[H.id]}}}function T(H){for(const K in a){const ft=a[K],dt=H.isInstancedMesh===!0?H.id:0,J=ft[dt];if(J!==void 0){for(const F in J){const N=J[F];for(const V in N)g(N[V].object),delete N[V];delete J[F]}delete ft[dt],Object.keys(ft).length===0&&delete a[K]}}}function P(){k(),u=!0,l!==o&&(l=o,p(l.object))}function k(){o.geometry=null,o.program=null,o.wireframe=!1}return{setup:h,reset:P,resetDefaultState:k,dispose:O,releaseStatesOfGeometry:U,releaseStatesOfObject:T,releaseStatesOfProgram:z,initAttributes:C,enableAttribute:M,disableUnusedAttributes:I}}function j2(s,t,e){let a;function o(d){a=d}function l(d,p){s.drawArrays(a,d,p),e.update(p,a,1)}function u(d,p,g){g!==0&&(s.drawArraysInstanced(a,d,p,g),e.update(p,a,g))}function h(d,p,g){if(g===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(a,d,0,p,0,g);let v=0;for(let x=0;x<g;x++)v+=p[x];e.update(v,a,1)}this.setMode=o,this.render=l,this.renderInstances=u,this.renderMultiDraw=h}function tw(s,t,e,a){let o;function l(){if(o!==void 0)return o;if(t.has("EXT_texture_filter_anisotropic")===!0){const z=t.get("EXT_texture_filter_anisotropic");o=s.getParameter(z.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else o=0;return o}function u(z){return!(z!==ta&&a.convert(z)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_FORMAT))}function h(z){const T=z===$a&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(z!==Di&&a.convert(z)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_TYPE)&&z!==ji&&!T)}function d(z){if(z==="highp"){if(s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.HIGH_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.HIGH_FLOAT).precision>0)return"highp";z="mediump"}return z==="mediump"&&s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.MEDIUM_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let p=e.precision!==void 0?e.precision:"highp";const g=d(p);g!==p&&(ge("WebGLRenderer:",p,"not supported, using",g,"instead."),p=g);const _=e.logarithmicDepthBuffer===!0,v=e.reversedDepthBuffer===!0&&t.has("EXT_clip_control");e.reversedDepthBuffer===!0&&v===!1&&ge("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");const x=s.getParameter(s.MAX_TEXTURE_IMAGE_UNITS),b=s.getParameter(s.MAX_VERTEX_TEXTURE_IMAGE_UNITS),C=s.getParameter(s.MAX_TEXTURE_SIZE),M=s.getParameter(s.MAX_CUBE_MAP_TEXTURE_SIZE),y=s.getParameter(s.MAX_VERTEX_ATTRIBS),I=s.getParameter(s.MAX_VERTEX_UNIFORM_VECTORS),D=s.getParameter(s.MAX_VARYING_VECTORS),A=s.getParameter(s.MAX_FRAGMENT_UNIFORM_VECTORS),O=s.getParameter(s.MAX_SAMPLES),U=s.getParameter(s.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:l,getMaxPrecision:d,textureFormatReadable:u,textureTypeReadable:h,precision:p,logarithmicDepthBuffer:_,reversedDepthBuffer:v,maxTextures:x,maxVertexTextures:b,maxTextureSize:C,maxCubemapSize:M,maxAttributes:y,maxVertexUniforms:I,maxVaryings:D,maxFragmentUniforms:A,maxSamples:O,samples:U}}function ew(s){const t=this;let e=null,a=0,o=!1,l=!1;const u=new hr,h=new Se,d={value:null,needsUpdate:!1};this.uniform=d,this.numPlanes=0,this.numIntersection=0,this.init=function(_,v){const x=_.length!==0||v||a!==0||o;return o=v,a=_.length,x},this.beginShadows=function(){l=!0,g(null)},this.endShadows=function(){l=!1},this.setGlobalState=function(_,v){e=g(_,v,0)},this.setState=function(_,v,x){const b=_.clippingPlanes,C=_.clipIntersection,M=_.clipShadows,y=s.get(_);if(!o||b===null||b.length===0||l&&!M)l?g(null):p();else{const I=l?0:a,D=I*4;let A=y.clippingState||null;d.value=A,A=g(b,v,D,x);for(let O=0;O!==D;++O)A[O]=e[O];y.clippingState=A,this.numIntersection=C?this.numPlanes:0,this.numPlanes+=I}};function p(){d.value!==e&&(d.value=e,d.needsUpdate=a>0),t.numPlanes=a,t.numIntersection=0}function g(_,v,x,b){const C=_!==null?_.length:0;let M=null;if(C!==0){if(M=d.value,b!==!0||M===null){const y=x+C*4,I=v.matrixWorldInverse;h.getNormalMatrix(I),(M===null||M.length<y)&&(M=new Float32Array(y));for(let D=0,A=x;D!==C;++D,A+=4)u.copy(_[D]).applyMatrix4(I,h),u.normal.toArray(M,A),M[A+3]=u.constant}d.value=M,d.needsUpdate=!0}return t.numPlanes=C,t.numIntersection=0,M}}const Is=4,ty=[.125,.215,.35,.446,.526,.582],mr=20,nw=256,Yl=new ng,ey=new pe;let gp=null,vp=0,_p=0,xp=!1;const iw=new q;class xm{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._sigmas=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(t,e=0,a=.1,o=100,l={}){const{size:u=256,position:h=iw}=l;gp=this._renderer.getRenderTarget(),vp=this._renderer.getActiveCubeFace(),_p=this._renderer.getActiveMipmapLevel(),xp=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(u);const d=this._allocateTargets();return d.depthBuffer=!0,this._sceneToCubeUV(t,a,o,d,h),e>0&&this._blur(d,0,0,e),this._applyPMREM(d),this._cleanup(d),d}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=ay(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=iy(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodMeshes.length;t++)this._lodMeshes[t].geometry.dispose()}_cleanup(t){this._renderer.setRenderTarget(gp,vp,_p),this._renderer.xr.enabled=xp,t.scissorTest=!1,To(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===yr||t.mapping===zo?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),gp=this._renderer.getRenderTarget(),vp=this._renderer.getActiveCubeFace(),_p=this._renderer.getActiveMipmapLevel(),xp=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const a=e||this._allocateTargets();return this._textureToCubeUV(t,a),this._applyPMREM(a),this._cleanup(a),a}_allocateTargets(){const t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,a={magFilter:ei,minFilter:ei,generateMipmaps:!1,type:$a,format:ta,colorSpace:df,depthBuffer:!1},o=ny(t,e,a);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=ny(t,e,a);const{_lodMax:l}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods,sigmas:this._sigmas}=aw(l)),this._blurMaterial=rw(l,t,e),this._ggxMaterial=sw(l,t,e)}return o}_compileMaterial(t){const e=new Ge(new li,t);this._renderer.compile(e,Yl)}_sceneToCubeUV(t,e,a,o,l){const d=new Ci(90,1,e,a),p=[1,-1,1,1,1,1],g=[1,1,1,-1,-1,-1],_=this._renderer,v=_.autoClear,x=_.toneMapping;_.getClearColor(ey),_.toneMapping=pa,_.autoClear=!1,_.state.buffers.depth.getReversed()&&(_.setRenderTarget(o),_.clearDepth(),_.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new Ge(new Qa,new Km({name:"PMREM.Background",side:ni,depthWrite:!1,depthTest:!1})));const C=this._backgroundBox,M=C.material;let y=!1;const I=t.background;I?I.isColor&&(M.color.copy(I),t.background=null,y=!0):(M.color.copy(ey),y=!0);for(let D=0;D<6;D++){const A=D%3;A===0?(d.up.set(0,p[D],0),d.position.set(l.x,l.y,l.z),d.lookAt(l.x+g[D],l.y,l.z)):A===1?(d.up.set(0,0,p[D]),d.position.set(l.x,l.y,l.z),d.lookAt(l.x,l.y+g[D],l.z)):(d.up.set(0,p[D],0),d.position.set(l.x,l.y,l.z),d.lookAt(l.x,l.y,l.z+g[D]));const O=this._cubeSize;To(o,A*O,D>2?O:0,O,O),_.setRenderTarget(o),y&&_.render(C,d),_.render(t,d)}_.toneMapping=x,_.autoClear=v,t.background=I}_textureToCubeUV(t,e){const a=this._renderer,o=t.mapping===yr||t.mapping===zo;o?(this._cubemapMaterial===null&&(this._cubemapMaterial=ay()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=iy());const l=o?this._cubemapMaterial:this._equirectMaterial,u=this._lodMeshes[0];u.material=l;const h=l.uniforms;h.envMap.value=t;const d=this._cubeSize;To(e,0,0,3*d,2*d),a.setRenderTarget(e),a.render(u,Yl)}_applyPMREM(t){const e=this._renderer,a=e.autoClear;e.autoClear=!1;const o=this._lodMeshes.length;for(let l=1;l<o;l++)this._applyGGXFilter(t,l-1,l);e.autoClear=a}_applyGGXFilter(t,e,a){const o=this._renderer,l=this._pingPongRenderTarget,u=this._ggxMaterial,h=this._lodMeshes[a];h.material=u;const d=u.uniforms,p=a/(this._lodMeshes.length-1),g=e/(this._lodMeshes.length-1),_=Math.sqrt(p*p-g*g),v=0+p*1.25,x=_*v,{_lodMax:b}=this,C=this._sizeLods[a],M=3*C*(a>b-Is?a-b+Is:0),y=4*(this._cubeSize-C);d.envMap.value=t.texture,d.roughness.value=x,d.mipInt.value=b-e,To(l,M,y,3*C,2*C),o.setRenderTarget(l),o.render(h,Yl),d.envMap.value=l.texture,d.roughness.value=0,d.mipInt.value=b-a,To(t,M,y,3*C,2*C),o.setRenderTarget(t),o.render(h,Yl)}_blur(t,e,a,o,l){const u=this._pingPongRenderTarget;this._halfBlur(t,u,e,a,o,"latitudinal",l),this._halfBlur(u,t,a,a,o,"longitudinal",l)}_halfBlur(t,e,a,o,l,u,h){const d=this._renderer,p=this._blurMaterial;u!=="latitudinal"&&u!=="longitudinal"&&Oe("blur direction must be either latitudinal or longitudinal!");const g=3,_=this._lodMeshes[o];_.material=p;const v=p.uniforms,x=this._sizeLods[a]-1,b=isFinite(l)?Math.PI/(2*x):2*Math.PI/(2*mr-1),C=l/b,M=isFinite(l)?1+Math.floor(g*C):mr;M>mr&&ge(`sigmaRadians, ${l}, is too large and will clip, as it requested ${M} samples when the maximum is set to ${mr}`);const y=[];let I=0;for(let z=0;z<mr;++z){const T=z/C,P=Math.exp(-T*T/2);y.push(P),z===0?I+=P:z<M&&(I+=2*P)}for(let z=0;z<y.length;z++)y[z]=y[z]/I;v.envMap.value=t.texture,v.samples.value=M,v.weights.value=y,v.latitudinal.value=u==="latitudinal",h&&(v.poleAxis.value=h);const{_lodMax:D}=this;v.dTheta.value=b,v.mipInt.value=D-a;const A=this._sizeLods[o],O=3*A*(o>D-Is?o-D+Is:0),U=4*(this._cubeSize-A);To(e,O,U,3*A,2*A),d.setRenderTarget(e),d.render(_,Yl)}}function aw(s){const t=[],e=[],a=[];let o=s;const l=s-Is+1+ty.length;for(let u=0;u<l;u++){const h=Math.pow(2,o);t.push(h);let d=1/h;u>s-Is?d=ty[u-s+Is-1]:u===0&&(d=0),e.push(d);const p=1/(h-2),g=-p,_=1+p,v=[g,g,_,g,_,_,g,g,_,_,g,_],x=6,b=6,C=3,M=2,y=1,I=new Float32Array(C*b*x),D=new Float32Array(M*b*x),A=new Float32Array(y*b*x);for(let U=0;U<x;U++){const z=U%3*2/3-1,T=U>2?0:-1,P=[z,T,0,z+2/3,T,0,z+2/3,T+1,0,z,T,0,z+2/3,T+1,0,z,T+1,0];I.set(P,C*b*U),D.set(v,M*b*U);const k=[U,U,U,U,U,U];A.set(k,y*b*U)}const O=new li;O.setAttribute("position",new ki(I,C)),O.setAttribute("uv",new ki(D,M)),O.setAttribute("faceIndex",new ki(A,y)),a.push(new Ge(O,null)),o>Is&&o--}return{lodMeshes:a,sizeLods:t,sigmas:e}}function ny(s,t,e){const a=new ma(s,t,e);return a.texture.mapping=bf,a.texture.name="PMREM.cubeUv",a.scissorTest=!0,a}function To(s,t,e,a,o){s.viewport.set(t,e,a,o),s.scissor.set(t,e,a,o)}function sw(s,t,e){return new Ui({name:"PMREMGGXConvolution",defines:{GGX_SAMPLES:nw,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Ef(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:Za,depthTest:!1,depthWrite:!1})}function rw(s,t,e){const a=new Float32Array(mr),o=new q(0,1,0);return new Ui({name:"SphericalGaussianBlur",defines:{n:mr,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:a},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:o}},vertexShader:Ef(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Za,depthTest:!1,depthWrite:!1})}function iy(){return new Ui({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Ef(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Za,depthTest:!1,depthWrite:!1})}function ay(){return new Ui({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Ef(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Za,depthTest:!1,depthWrite:!1})}function Ef(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}class xS extends ma{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;const a={width:t,height:t,depth:1},o=[a,a,a,a,a,a];this.texture=new eS(o),this._setTextureOptions(e),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;const a={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},o=new Qa(5,5,5),l=new Ui({name:"CubemapFromEquirect",uniforms:ko(a.uniforms),vertexShader:a.vertexShader,fragmentShader:a.fragmentShader,side:ni,blending:Za});l.uniforms.tEquirect.value=e;const u=new Ge(o,l),h=e.minFilter;return e.minFilter===vr&&(e.minFilter=ei),new fT(1,10,this).update(t,u),e.minFilter=h,u.geometry.dispose(),u.material.dispose(),this}clear(t,e=!0,a=!0,o=!0){const l=t.getRenderTarget();for(let u=0;u<6;u++)t.setRenderTarget(this,u),t.clear(e,a,o);t.setRenderTarget(l)}}function ow(s){let t=new WeakMap,e=new WeakMap,a=null;function o(v,x=!1){return v==null?null:x?u(v):l(v)}function l(v){if(v&&v.isTexture){const x=v.mapping;if(x===Id||x===zd)if(t.has(v)){const b=t.get(v).texture;return h(b,v.mapping)}else{const b=v.image;if(b&&b.height>0){const C=new xS(b.height);return C.fromEquirectangularTexture(s,v),t.set(v,C),v.addEventListener("dispose",p),h(C.texture,v.mapping)}else return null}}return v}function u(v){if(v&&v.isTexture){const x=v.mapping,b=x===Id||x===zd,C=x===yr||x===zo;if(b||C){let M=e.get(v);const y=M!==void 0?M.texture.pmremVersion:0;if(v.isRenderTargetTexture&&v.pmremVersion!==y)return a===null&&(a=new xm(s)),M=b?a.fromEquirectangular(v,M):a.fromCubemap(v,M),M.texture.pmremVersion=v.pmremVersion,e.set(v,M),M.texture;if(M!==void 0)return M.texture;{const I=v.image;return b&&I&&I.height>0||C&&I&&d(I)?(a===null&&(a=new xm(s)),M=b?a.fromEquirectangular(v):a.fromCubemap(v),M.texture.pmremVersion=v.pmremVersion,e.set(v,M),v.addEventListener("dispose",g),M.texture):null}}}return v}function h(v,x){return x===Id?v.mapping=yr:x===zd&&(v.mapping=zo),v}function d(v){let x=0;const b=6;for(let C=0;C<b;C++)v[C]!==void 0&&x++;return x===b}function p(v){const x=v.target;x.removeEventListener("dispose",p);const b=t.get(x);b!==void 0&&(t.delete(x),b.dispose())}function g(v){const x=v.target;x.removeEventListener("dispose",g);const b=e.get(x);b!==void 0&&(e.delete(x),b.dispose())}function _(){t=new WeakMap,e=new WeakMap,a!==null&&(a.dispose(),a=null)}return{get:o,dispose:_}}function lw(s){const t={};function e(a){if(t[a]!==void 0)return t[a];const o=s.getExtension(a);return t[a]=o,o}return{has:function(a){return e(a)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(a){const o=e(a);return o===null&&Oo("WebGLRenderer: "+a+" extension not supported."),o}}}function cw(s,t,e,a){const o={},l=new WeakMap;function u(_){const v=_.target;v.index!==null&&t.remove(v.index);for(const b in v.attributes)t.remove(v.attributes[b]);v.removeEventListener("dispose",u),delete o[v.id];const x=l.get(v);x&&(t.remove(x),l.delete(v)),a.releaseStatesOfGeometry(v),v.isInstancedBufferGeometry===!0&&delete v._maxInstanceCount,e.memory.geometries--}function h(_,v){return o[v.id]===!0||(v.addEventListener("dispose",u),o[v.id]=!0,e.memory.geometries++),v}function d(_){const v=_.attributes;for(const x in v)t.update(v[x],s.ARRAY_BUFFER)}function p(_){const v=[],x=_.index,b=_.attributes.position;let C=0;if(b===void 0)return;if(x!==null){const I=x.array;C=x.version;for(let D=0,A=I.length;D<A;D+=3){const O=I[D+0],U=I[D+1],z=I[D+2];v.push(O,U,U,z,z,O)}}else{const I=b.array;C=b.version;for(let D=0,A=I.length/3-1;D<A;D+=3){const O=D+0,U=D+1,z=D+2;v.push(O,U,U,z,z,O)}}const M=new(b.count>=65535?Jy:Ky)(v,1);M.version=C;const y=l.get(_);y&&t.remove(y),l.set(_,M)}function g(_){const v=l.get(_);if(v){const x=_.index;x!==null&&v.version<x.version&&p(_)}else p(_);return l.get(_)}return{get:h,update:d,getWireframeAttribute:g}}function uw(s,t,e){let a;function o(_){a=_}let l,u;function h(_){l=_.type,u=_.bytesPerElement}function d(_,v){s.drawElements(a,v,l,_*u),e.update(v,a,1)}function p(_,v,x){x!==0&&(s.drawElementsInstanced(a,v,l,_*u,x),e.update(v,a,x))}function g(_,v,x){if(x===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(a,v,0,l,_,0,x);let C=0;for(let M=0;M<x;M++)C+=v[M];e.update(C,a,1)}this.setMode=o,this.setIndex=h,this.render=d,this.renderInstances=p,this.renderMultiDraw=g}function fw(s){const t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function a(l,u,h){switch(e.calls++,u){case s.TRIANGLES:e.triangles+=h*(l/3);break;case s.LINES:e.lines+=h*(l/2);break;case s.LINE_STRIP:e.lines+=h*(l-1);break;case s.LINE_LOOP:e.lines+=h*l;break;case s.POINTS:e.points+=h*l;break;default:Oe("WebGLInfo: Unknown draw mode:",u);break}}function o(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:o,update:a}}function hw(s,t,e){const a=new WeakMap,o=new pn;function l(u,h,d){const p=u.morphTargetInfluences,g=h.morphAttributes.position||h.morphAttributes.normal||h.morphAttributes.color,_=g!==void 0?g.length:0;let v=a.get(h);if(v===void 0||v.count!==_){let k=function(){T.dispose(),a.delete(h),h.removeEventListener("dispose",k)};var x=k;v!==void 0&&v.texture.dispose();const b=h.morphAttributes.position!==void 0,C=h.morphAttributes.normal!==void 0,M=h.morphAttributes.color!==void 0,y=h.morphAttributes.position||[],I=h.morphAttributes.normal||[],D=h.morphAttributes.color||[];let A=0;b===!0&&(A=1),C===!0&&(A=2),M===!0&&(A=3);let O=h.attributes.position.count*A,U=1;O>t.maxTextureSize&&(U=Math.ceil(O/t.maxTextureSize),O=t.maxTextureSize);const z=new Float32Array(O*U*4*_),T=new qy(z,O,U,_);T.type=ji,T.needsUpdate=!0;const P=A*4;for(let H=0;H<_;H++){const K=y[H],ft=I[H],dt=D[H],J=O*U*4*H;for(let F=0;F<K.count;F++){const N=F*P;b===!0&&(o.fromBufferAttribute(K,F),z[J+N+0]=o.x,z[J+N+1]=o.y,z[J+N+2]=o.z,z[J+N+3]=0),C===!0&&(o.fromBufferAttribute(ft,F),z[J+N+4]=o.x,z[J+N+5]=o.y,z[J+N+6]=o.z,z[J+N+7]=0),M===!0&&(o.fromBufferAttribute(dt,F),z[J+N+8]=o.x,z[J+N+9]=o.y,z[J+N+10]=o.z,z[J+N+11]=dt.itemSize===4?o.w:1)}}v={count:_,texture:T,size:new Ut(O,U)},a.set(h,v),h.addEventListener("dispose",k)}if(u.isInstancedMesh===!0&&u.morphTexture!==null)d.getUniforms().setValue(s,"morphTexture",u.morphTexture,e);else{let b=0;for(let M=0;M<p.length;M++)b+=p[M];const C=h.morphTargetsRelative?1:1-b;d.getUniforms().setValue(s,"morphTargetBaseInfluence",C),d.getUniforms().setValue(s,"morphTargetInfluences",p)}d.getUniforms().setValue(s,"morphTargetsTexture",v.texture,e),d.getUniforms().setValue(s,"morphTargetsTextureSize",v.size)}return{update:l}}function dw(s,t,e,a,o){let l=new WeakMap;function u(p){const g=o.render.frame,_=p.geometry,v=t.get(p,_);if(l.get(v)!==g&&(t.update(v),l.set(v,g)),p.isInstancedMesh&&(p.hasEventListener("dispose",d)===!1&&p.addEventListener("dispose",d),l.get(p)!==g&&(e.update(p.instanceMatrix,s.ARRAY_BUFFER),p.instanceColor!==null&&e.update(p.instanceColor,s.ARRAY_BUFFER),l.set(p,g))),p.isSkinnedMesh){const x=p.skeleton;l.get(x)!==g&&(x.update(),l.set(x,g))}return v}function h(){l=new WeakMap}function d(p){const g=p.target;g.removeEventListener("dispose",d),a.releaseStatesOfObject(g),e.remove(g.instanceMatrix),g.instanceColor!==null&&e.remove(g.instanceColor)}return{update:u,dispose:h}}const pw={[Ly]:"LINEAR_TONE_MAPPING",[Ny]:"REINHARD_TONE_MAPPING",[Oy]:"CINEON_TONE_MAPPING",[Py]:"ACES_FILMIC_TONE_MAPPING",[Iy]:"AGX_TONE_MAPPING",[Bm]:"NEUTRAL_TONE_MAPPING",[By]:"CUSTOM_TONE_MAPPING"};function mw(s,t,e,a,o,l){const u=new ma(t,e,{type:s,depthBuffer:o,stencilBuffer:l,samples:a?4:0,depthTexture:o?new Ho(t,e):void 0}),h=new ma(t,e,{type:$a,depthBuffer:!1,stencilBuffer:!1}),d=new li;d.setAttribute("position",new gn([-1,3,0,-1,-1,0,3,-1,0],3)),d.setAttribute("uv",new gn([0,2,0,0,2,0],2));const p=new j1({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),g=new Ge(d,p),_=new ng(-1,1,1,-1,0,1);let v=null,x=null,b=!1,C,M=null,y=[],I=!1;this.setSize=function(D,A){u.setSize(D,A),h.setSize(D,A);for(let O=0;O<y.length;O++){const U=y[O];U.setSize&&U.setSize(D,A)}},this.setEffects=function(D){y=D,I=y.length>0&&y[0].isRenderPass===!0;const A=u.width,O=u.height;for(let U=0;U<y.length;U++){const z=y[U];z.setSize&&z.setSize(A,O)}},this.begin=function(D,A){if(b||D.toneMapping===pa&&y.length===0)return!1;if(M=A,A!==null){const O=A.width,U=A.height;(u.width!==O||u.height!==U)&&this.setSize(O,U)}return I===!1&&D.setRenderTarget(u),C=D.toneMapping,D.toneMapping=pa,!0},this.hasRenderPass=function(){return I},this.end=function(D,A){D.toneMapping=C,b=!0;let O=u,U=h;for(let z=0;z<y.length;z++){const T=y[z];if(T.enabled!==!1&&(T.render(D,U,O,A),T.needsSwap!==!1)){const P=O;O=U,U=P}}if(v!==D.outputColorSpace||x!==D.toneMapping){v=D.outputColorSpace,x=D.toneMapping,p.defines={},Ie.getTransfer(v)===Je&&(p.defines.SRGB_TRANSFER="");const z=pw[x];z&&(p.defines[z]=""),p.needsUpdate=!0}p.uniforms.tDiffuse.value=O.texture,D.setRenderTarget(M),D.render(g,_),M=null,b=!1},this.isCompositing=function(){return b},this.dispose=function(){u.depthTexture&&u.depthTexture.dispose(),u.dispose(),h.dispose(),d.dispose(),p.dispose()}}const yS=new Yn,ym=new Ho(1,1),SS=new qy,MS=new jE,bS=new eS,sy=[],ry=[],oy=new Float32Array(16),ly=new Float32Array(9),cy=new Float32Array(4);function Wo(s,t,e){const a=s[0];if(a<=0||a>0)return s;const o=t*e;let l=sy[o];if(l===void 0&&(l=new Float32Array(o),sy[o]=l),t!==0){a.toArray(l,0);for(let u=1,h=0;u!==t;++u)h+=e,s[u].toArray(l,h)}return l}function Nn(s,t){if(s.length!==t.length)return!1;for(let e=0,a=s.length;e<a;e++)if(s[e]!==t[e])return!1;return!0}function On(s,t){for(let e=0,a=t.length;e<a;e++)s[e]=t[e]}function Tf(s,t){let e=ry[t];e===void 0&&(e=new Int32Array(t),ry[t]=e);for(let a=0;a!==t;++a)e[a]=s.allocateTextureUnit();return e}function gw(s,t){const e=this.cache;e[0]!==t&&(s.uniform1f(this.addr,t),e[0]=t)}function vw(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Nn(e,t))return;s.uniform2fv(this.addr,t),On(e,t)}}function _w(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(s.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(Nn(e,t))return;s.uniform3fv(this.addr,t),On(e,t)}}function xw(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Nn(e,t))return;s.uniform4fv(this.addr,t),On(e,t)}}function yw(s,t){const e=this.cache,a=t.elements;if(a===void 0){if(Nn(e,t))return;s.uniformMatrix2fv(this.addr,!1,t),On(e,t)}else{if(Nn(e,a))return;cy.set(a),s.uniformMatrix2fv(this.addr,!1,cy),On(e,a)}}function Sw(s,t){const e=this.cache,a=t.elements;if(a===void 0){if(Nn(e,t))return;s.uniformMatrix3fv(this.addr,!1,t),On(e,t)}else{if(Nn(e,a))return;ly.set(a),s.uniformMatrix3fv(this.addr,!1,ly),On(e,a)}}function Mw(s,t){const e=this.cache,a=t.elements;if(a===void 0){if(Nn(e,t))return;s.uniformMatrix4fv(this.addr,!1,t),On(e,t)}else{if(Nn(e,a))return;oy.set(a),s.uniformMatrix4fv(this.addr,!1,oy),On(e,a)}}function bw(s,t){const e=this.cache;e[0]!==t&&(s.uniform1i(this.addr,t),e[0]=t)}function Ew(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Nn(e,t))return;s.uniform2iv(this.addr,t),On(e,t)}}function Tw(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Nn(e,t))return;s.uniform3iv(this.addr,t),On(e,t)}}function Aw(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Nn(e,t))return;s.uniform4iv(this.addr,t),On(e,t)}}function ww(s,t){const e=this.cache;e[0]!==t&&(s.uniform1ui(this.addr,t),e[0]=t)}function Rw(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(Nn(e,t))return;s.uniform2uiv(this.addr,t),On(e,t)}}function Cw(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(Nn(e,t))return;s.uniform3uiv(this.addr,t),On(e,t)}}function Dw(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(Nn(e,t))return;s.uniform4uiv(this.addr,t),On(e,t)}}function Uw(s,t,e){const a=this.cache,o=e.allocateTextureUnit();a[0]!==o&&(s.uniform1i(this.addr,o),a[0]=o);let l;this.type===s.SAMPLER_2D_SHADOW?(ym.compareFunction=e.isReversedDepthBuffer()?Wm:Xm,l=ym):l=yS,e.setTexture2D(t||l,o)}function Lw(s,t,e){const a=this.cache,o=e.allocateTextureUnit();a[0]!==o&&(s.uniform1i(this.addr,o),a[0]=o),e.setTexture3D(t||MS,o)}function Nw(s,t,e){const a=this.cache,o=e.allocateTextureUnit();a[0]!==o&&(s.uniform1i(this.addr,o),a[0]=o),e.setTextureCube(t||bS,o)}function Ow(s,t,e){const a=this.cache,o=e.allocateTextureUnit();a[0]!==o&&(s.uniform1i(this.addr,o),a[0]=o),e.setTexture2DArray(t||SS,o)}function Pw(s){switch(s){case 5126:return gw;case 35664:return vw;case 35665:return _w;case 35666:return xw;case 35674:return yw;case 35675:return Sw;case 35676:return Mw;case 5124:case 35670:return bw;case 35667:case 35671:return Ew;case 35668:case 35672:return Tw;case 35669:case 35673:return Aw;case 5125:return ww;case 36294:return Rw;case 36295:return Cw;case 36296:return Dw;case 35678:case 36198:case 36298:case 36306:case 35682:return Uw;case 35679:case 36299:case 36307:return Lw;case 35680:case 36300:case 36308:case 36293:return Nw;case 36289:case 36303:case 36311:case 36292:return Ow}}function Bw(s,t){s.uniform1fv(this.addr,t)}function Iw(s,t){const e=Wo(t,this.size,2);s.uniform2fv(this.addr,e)}function zw(s,t){const e=Wo(t,this.size,3);s.uniform3fv(this.addr,e)}function Fw(s,t){const e=Wo(t,this.size,4);s.uniform4fv(this.addr,e)}function Hw(s,t){const e=Wo(t,this.size,4);s.uniformMatrix2fv(this.addr,!1,e)}function Gw(s,t){const e=Wo(t,this.size,9);s.uniformMatrix3fv(this.addr,!1,e)}function Vw(s,t){const e=Wo(t,this.size,16);s.uniformMatrix4fv(this.addr,!1,e)}function kw(s,t){s.uniform1iv(this.addr,t)}function Xw(s,t){s.uniform2iv(this.addr,t)}function Ww(s,t){s.uniform3iv(this.addr,t)}function qw(s,t){s.uniform4iv(this.addr,t)}function Yw(s,t){s.uniform1uiv(this.addr,t)}function Zw(s,t){s.uniform2uiv(this.addr,t)}function Kw(s,t){s.uniform3uiv(this.addr,t)}function Jw(s,t){s.uniform4uiv(this.addr,t)}function Qw(s,t,e){const a=this.cache,o=t.length,l=Tf(e,o);Nn(a,l)||(s.uniform1iv(this.addr,l),On(a,l));let u;this.type===s.SAMPLER_2D_SHADOW?u=ym:u=yS;for(let h=0;h!==o;++h)e.setTexture2D(t[h]||u,l[h])}function $w(s,t,e){const a=this.cache,o=t.length,l=Tf(e,o);Nn(a,l)||(s.uniform1iv(this.addr,l),On(a,l));for(let u=0;u!==o;++u)e.setTexture3D(t[u]||MS,l[u])}function jw(s,t,e){const a=this.cache,o=t.length,l=Tf(e,o);Nn(a,l)||(s.uniform1iv(this.addr,l),On(a,l));for(let u=0;u!==o;++u)e.setTextureCube(t[u]||bS,l[u])}function t3(s,t,e){const a=this.cache,o=t.length,l=Tf(e,o);Nn(a,l)||(s.uniform1iv(this.addr,l),On(a,l));for(let u=0;u!==o;++u)e.setTexture2DArray(t[u]||SS,l[u])}function e3(s){switch(s){case 5126:return Bw;case 35664:return Iw;case 35665:return zw;case 35666:return Fw;case 35674:return Hw;case 35675:return Gw;case 35676:return Vw;case 5124:case 35670:return kw;case 35667:case 35671:return Xw;case 35668:case 35672:return Ww;case 35669:case 35673:return qw;case 5125:return Yw;case 36294:return Zw;case 36295:return Kw;case 36296:return Jw;case 35678:case 36198:case 36298:case 36306:case 35682:return Qw;case 35679:case 36299:case 36307:return $w;case 35680:case 36300:case 36308:case 36293:return jw;case 36289:case 36303:case 36311:case 36292:return t3}}class n3{constructor(t,e,a){this.id=t,this.addr=a,this.cache=[],this.type=e.type,this.setValue=Pw(e.type)}}class i3{constructor(t,e,a){this.id=t,this.addr=a,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=e3(e.type)}}class a3{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,a){const o=this.seq;for(let l=0,u=o.length;l!==u;++l){const h=o[l];h.setValue(t,e[h.id],a)}}}const yp=/(\w+)(\])?(\[|\.)?/g;function uy(s,t){s.seq.push(t),s.map[t.id]=t}function s3(s,t,e){const a=s.name,o=a.length;for(yp.lastIndex=0;;){const l=yp.exec(a),u=yp.lastIndex;let h=l[1];const d=l[2]==="]",p=l[3];if(d&&(h=h|0),p===void 0||p==="["&&u+2===o){uy(e,p===void 0?new n3(h,s,t):new i3(h,s,t));break}else{let _=e.map[h];_===void 0&&(_=new a3(h),uy(e,_)),e=_}}}class rf{constructor(t,e){this.seq=[],this.map={};const a=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let u=0;u<a;++u){const h=t.getActiveUniform(e,u),d=t.getUniformLocation(e,h.name);s3(h,d,this)}const o=[],l=[];for(const u of this.seq)u.type===t.SAMPLER_2D_SHADOW||u.type===t.SAMPLER_CUBE_SHADOW||u.type===t.SAMPLER_2D_ARRAY_SHADOW?o.push(u):l.push(u);o.length>0&&(this.seq=o.concat(l))}setValue(t,e,a,o){const l=this.map[e];l!==void 0&&l.setValue(t,a,o)}setOptional(t,e,a){const o=e[a];o!==void 0&&this.setValue(t,a,o)}static upload(t,e,a,o){for(let l=0,u=e.length;l!==u;++l){const h=e[l],d=a[h.id];d.needsUpdate!==!1&&h.setValue(t,d.value,o)}}static seqWithValue(t,e){const a=[];for(let o=0,l=t.length;o!==l;++o){const u=t[o];u.id in e&&a.push(u)}return a}}function fy(s,t,e){const a=s.createShader(t);return s.shaderSource(a,e),s.compileShader(a),a}const r3=37297;let o3=0;function l3(s,t){const e=s.split(`
`),a=[],o=Math.max(t-6,0),l=Math.min(t+6,e.length);for(let u=o;u<l;u++){const h=u+1;a.push(`${h===t?">":" "} ${h}: ${e[u]}`)}return a.join(`
`)}const hy=new Se;function c3(s){Ie._getMatrix(hy,Ie.workingColorSpace,s);const t=`mat3( ${hy.elements.map(e=>e.toFixed(4))} )`;switch(Ie.getTransfer(s)){case pf:return[t,"LinearTransferOETF"];case Je:return[t,"sRGBTransferOETF"];default:return ge("WebGLProgram: Unsupported color space: ",s),[t,"LinearTransferOETF"]}}function dy(s,t,e){const a=s.getShaderParameter(t,s.COMPILE_STATUS),l=(s.getShaderInfoLog(t)||"").trim();if(a&&l==="")return"";const u=/ERROR: 0:(\d+)/.exec(l);if(u){const h=parseInt(u[1]);return e.toUpperCase()+`

`+l+`

`+l3(s.getShaderSource(t),h)}else return l}function u3(s,t){const e=c3(t);return[`vec4 ${s}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}const f3={[Ly]:"Linear",[Ny]:"Reinhard",[Oy]:"Cineon",[Py]:"ACESFilmic",[Iy]:"AgX",[Bm]:"Neutral",[By]:"Custom"};function h3(s,t){const e=f3[t];return e===void 0?(ge("WebGLProgram: Unsupported toneMapping:",t),"vec3 "+s+"( vec3 color ) { return LinearToneMapping( color ); }"):"vec3 "+s+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}const ju=new q;function d3(){Ie.getLuminanceCoefficients(ju);const s=ju.x.toFixed(4),t=ju.y.toFixed(4),e=ju.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${s}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function p3(s){return[s.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",s.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Ql).join(`
`)}function m3(s){const t=[];for(const e in s){const a=s[e];a!==!1&&t.push("#define "+e+" "+a)}return t.join(`
`)}function g3(s,t){const e={},a=s.getProgramParameter(t,s.ACTIVE_ATTRIBUTES);for(let o=0;o<a;o++){const l=s.getActiveAttrib(t,o),u=l.name;let h=1;l.type===s.FLOAT_MAT2&&(h=2),l.type===s.FLOAT_MAT3&&(h=3),l.type===s.FLOAT_MAT4&&(h=4),e[u]={type:l.type,location:s.getAttribLocation(t,u),locationSize:h}}return e}function Ql(s){return s!==""}function py(s,t){const e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return s.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function my(s,t){return s.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}const v3=/^[ \t]*#include +<([\w\d./]+)>/gm;function Sm(s){return s.replace(v3,x3)}const _3=new Map;function x3(s,t){let e=Ae[t];if(e===void 0){const a=_3.get(t);if(a!==void 0)e=Ae[a],ge('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,a);else throw new Error("THREE.WebGLProgram: Can not resolve #include <"+t+">")}return Sm(e)}const y3=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function gy(s){return s.replace(y3,S3)}function S3(s,t,e,a){let o="";for(let l=parseInt(t);l<parseInt(e);l++)o+=a.replace(/\[\s*i\s*\]/g,"[ "+l+" ]").replace(/UNROLLED_LOOP_INDEX/g,l);return o}function vy(s){let t=`precision ${s.precision} float;
	precision ${s.precision} int;
	precision ${s.precision} sampler2D;
	precision ${s.precision} samplerCube;
	precision ${s.precision} sampler3D;
	precision ${s.precision} sampler2DArray;
	precision ${s.precision} sampler2DShadow;
	precision ${s.precision} samplerCubeShadow;
	precision ${s.precision} sampler2DArrayShadow;
	precision ${s.precision} isampler2D;
	precision ${s.precision} isampler3D;
	precision ${s.precision} isamplerCube;
	precision ${s.precision} isampler2DArray;
	precision ${s.precision} usampler2D;
	precision ${s.precision} usampler3D;
	precision ${s.precision} usamplerCube;
	precision ${s.precision} usampler2DArray;
	`;return s.precision==="highp"?t+=`
#define HIGH_PRECISION`:s.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:s.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}const M3={[tf]:"SHADOWMAP_TYPE_PCF",[Kl]:"SHADOWMAP_TYPE_VSM"};function b3(s){return M3[s.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}const E3={[yr]:"ENVMAP_TYPE_CUBE",[zo]:"ENVMAP_TYPE_CUBE",[bf]:"ENVMAP_TYPE_CUBE_UV"};function T3(s){return s.envMap===!1?"ENVMAP_TYPE_CUBE":E3[s.envMapMode]||"ENVMAP_TYPE_CUBE"}const A3={[zo]:"ENVMAP_MODE_REFRACTION"};function w3(s){return s.envMap===!1?"ENVMAP_MODE_REFLECTION":A3[s.envMapMode]||"ENVMAP_MODE_REFLECTION"}const R3={[Pm]:"ENVMAP_BLENDING_MULTIPLY",[LE]:"ENVMAP_BLENDING_MIX",[NE]:"ENVMAP_BLENDING_ADD"};function C3(s){return s.envMap===!1?"ENVMAP_BLENDING_NONE":R3[s.combine]||"ENVMAP_BLENDING_NONE"}function D3(s){const t=s.envMapCubeUVHeight;if(t===null)return null;const e=Math.log2(t)-2,a=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),112)),texelHeight:a,maxMip:e}}function U3(s,t,e,a){const o=s.getContext(),l=e.defines;let u=e.vertexShader,h=e.fragmentShader;const d=b3(e),p=T3(e),g=w3(e),_=C3(e),v=D3(e),x=p3(e),b=m3(l),C=o.createProgram();let M,y,I=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(M=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,b].filter(Ql).join(`
`),M.length>0&&(M+=`
`),y=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,b].filter(Ql).join(`
`),y.length>0&&(y+=`
`)):(M=[vy(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,b,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+g:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexNormals?"#define HAS_NORMAL":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+d:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Ql).join(`
`),y=[vy(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,b,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+p:"",e.envMap?"#define "+g:"",e.envMap?"#define "+_:"",v?"#define CUBEUV_TEXEL_WIDTH "+v.texelWidth:"",v?"#define CUBEUV_TEXEL_HEIGHT "+v.texelHeight:"",v?"#define CUBEUV_MAX_MIP "+v.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor?"#define USE_COLOR":"",e.vertexAlphas||e.batchingColor?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+d:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.numLightProbeGrids>0?"#define USE_LIGHT_PROBES_GRID":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",e.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==pa?"#define TONE_MAPPING":"",e.toneMapping!==pa?Ae.tonemapping_pars_fragment:"",e.toneMapping!==pa?h3("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",Ae.colorspace_pars_fragment,u3("linearToOutputTexel",e.outputColorSpace),d3(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(Ql).join(`
`)),u=Sm(u),u=py(u,e),u=my(u,e),h=Sm(h),h=py(h,e),h=my(h,e),u=gy(u),h=gy(h),e.isRawShaderMaterial!==!0&&(I=`#version 300 es
`,M=[x,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+M,y=["#define varying in",e.glslVersion===px?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===px?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+y);const D=I+M+u,A=I+y+h,O=fy(o,o.VERTEX_SHADER,D),U=fy(o,o.FRAGMENT_SHADER,A);o.attachShader(C,O),o.attachShader(C,U),e.index0AttributeName!==void 0?o.bindAttribLocation(C,0,e.index0AttributeName):e.hasPositionAttribute===!0&&o.bindAttribLocation(C,0,"position"),o.linkProgram(C);function z(H){if(s.debug.checkShaderErrors){const K=o.getProgramInfoLog(C)||"",ft=o.getShaderInfoLog(O)||"",dt=o.getShaderInfoLog(U)||"",J=K.trim(),F=ft.trim(),N=dt.trim();let V=!0,nt=!0;if(o.getProgramParameter(C,o.LINK_STATUS)===!1)if(V=!1,typeof s.debug.onShaderError=="function")s.debug.onShaderError(o,C,O,U);else{const mt=dy(o,O,"vertex"),L=dy(o,U,"fragment");Oe("WebGLProgram: Shader Error "+o.getError()+" - VALIDATE_STATUS "+o.getProgramParameter(C,o.VALIDATE_STATUS)+`

Material Name: `+H.name+`
Material Type: `+H.type+`

Program Info Log: `+J+`
`+mt+`
`+L)}else J!==""?ge("WebGLProgram: Program Info Log:",J):(F===""||N==="")&&(nt=!1);nt&&(H.diagnostics={runnable:V,programLog:J,vertexShader:{log:F,prefix:M},fragmentShader:{log:N,prefix:y}})}o.deleteShader(O),o.deleteShader(U),T=new rf(o,C),P=g3(o,C)}let T;this.getUniforms=function(){return T===void 0&&z(this),T};let P;this.getAttributes=function(){return P===void 0&&z(this),P};let k=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return k===!1&&(k=o.getProgramParameter(C,r3)),k},this.destroy=function(){a.releaseStatesOfProgram(this),o.deleteProgram(C),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=o3++,this.cacheKey=t,this.usedTimes=1,this.program=C,this.vertexShader=O,this.fragmentShader=U,this}let L3=0;class N3{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t,e,a){const o=this._getShaderCacheForMaterial(t);return o.has(e)===!1&&(o.add(e),e.usedTimes++),o.has(a)===!1&&(o.add(a),a.usedTimes++),this}remove(t){const e=this.materialCache.get(t);for(const a of e)a.usedTimes--,a.usedTimes===0&&this.shaderCache.delete(a.code);return this.materialCache.delete(t),this}getVertexShaderStage(t){return this._getShaderStage(t.vertexShader)}getFragmentShaderStage(t){return this._getShaderStage(t.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){const e=this.materialCache;let a=e.get(t);return a===void 0&&(a=new Set,e.set(t,a)),a}_getShaderStage(t){const e=this.shaderCache;let a=e.get(t);return a===void 0&&(a=new O3(t),e.set(t,a)),a}}class O3{constructor(t){this.id=L3++,this.code=t,this.usedTimes=0}}function P3(s){return s===Sr||s===uf||s===ff}function B3(s,t,e,a,o,l){const u=new Ym,h=new N3,d=new Set,p=[],g=new Map,_=a.logarithmicDepthBuffer;let v=a.precision;const x={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function b(T){return d.add(T),T===0?"uv":`uv${T}`}function C(T,P,k,H,K,ft){const dt=H.fog,J=K.geometry,F=T.isMeshStandardMaterial||T.isMeshLambertMaterial||T.isMeshPhongMaterial?H.environment:null,N=T.isMeshStandardMaterial||T.isMeshLambertMaterial&&!T.envMap||T.isMeshPhongMaterial&&!T.envMap,V=t.get(T.envMap||F,N),nt=V&&V.mapping===bf?V.image.height:null,mt=x[T.type];T.precision!==null&&(v=a.getMaxPrecision(T.precision),v!==T.precision&&ge("WebGLProgram.getParameters:",T.precision,"not supported, using",v,"instead."));const L=J.morphAttributes.position||J.morphAttributes.normal||J.morphAttributes.color,X=L!==void 0?L.length:0;let _t=0;J.morphAttributes.position!==void 0&&(_t=1),J.morphAttributes.normal!==void 0&&(_t=2),J.morphAttributes.color!==void 0&&(_t=3);let Ct,Lt,et,Mt;if(mt){const Qt=ua[mt];Ct=Qt.vertexShader,Lt=Qt.fragmentShader}else{Ct=T.vertexShader,Lt=T.fragmentShader;const Qt=h.getVertexShaderStage(T),cn=h.getFragmentShaderStage(T);h.update(T,Qt,cn),et=Qt.id,Mt=cn.id}const Et=s.getRenderTarget(),zt=s.state.buffers.depth.getReversed(),oe=K.isInstancedMesh===!0,ae=K.isBatchedMesh===!0,Pe=!!T.map,me=!!T.matcap,Tt=!!V,Rt=!!T.aoMap,wt=!!T.lightMap,kt=!!T.bumpMap&&T.wireframe===!1,Gt=!!T.normalMap,le=!!T.displacementMap,ne=!!T.emissiveMap,he=!!T.metalnessMap,xe=!!T.roughnessMap,W=T.anisotropy>0,Me=T.clearcoat>0,we=T.dispersion>0,B=T.iridescence>0,E=T.sheen>0,tt=T.transmission>0,ot=W&&!!T.anisotropyMap,gt=Me&&!!T.clearcoatMap,Dt=Me&&!!T.clearcoatNormalMap,Bt=Me&&!!T.clearcoatRoughnessMap,pt=B&&!!T.iridescenceMap,vt=B&&!!T.iridescenceThicknessMap,Ot=E&&!!T.sheenColorMap,Yt=E&&!!T.sheenRoughnessMap,Vt=!!T.specularMap,Ft=!!T.specularColorMap,re=!!T.specularIntensityMap,ce=tt&&!!T.transmissionMap,ve=tt&&!!T.thicknessMap,Z=!!T.gradientMap,Nt=!!T.alphaMap,yt=T.alphaTest>0,It=!!T.alphaHash,qt=!!T.extensions;let At=pa;T.toneMapped&&(Et===null||Et.isXRRenderTarget===!0)&&(At=s.toneMapping);const ee={shaderID:mt,shaderType:T.type,shaderName:T.name,vertexShader:Ct,fragmentShader:Lt,defines:T.defines,customVertexShaderID:et,customFragmentShaderID:Mt,isRawShaderMaterial:T.isRawShaderMaterial===!0,glslVersion:T.glslVersion,precision:v,batching:ae,batchingColor:ae&&K._colorsTexture!==null,instancing:oe,instancingColor:oe&&K.instanceColor!==null,instancingMorph:oe&&K.morphTexture!==null,outputColorSpace:Et===null?s.outputColorSpace:Et.isXRRenderTarget===!0?Et.texture.colorSpace:Ie.workingColorSpace,alphaToCoverage:!!T.alphaToCoverage,map:Pe,matcap:me,envMap:Tt,envMapMode:Tt&&V.mapping,envMapCubeUVHeight:nt,aoMap:Rt,lightMap:wt,bumpMap:kt,normalMap:Gt,displacementMap:le,emissiveMap:ne,normalMapObjectSpace:Gt&&T.normalMapType===BE,normalMapTangentSpace:Gt&&T.normalMapType===hf,packedNormalMap:Gt&&T.normalMapType===hf&&P3(T.normalMap.format),metalnessMap:he,roughnessMap:xe,anisotropy:W,anisotropyMap:ot,clearcoat:Me,clearcoatMap:gt,clearcoatNormalMap:Dt,clearcoatRoughnessMap:Bt,dispersion:we,iridescence:B,iridescenceMap:pt,iridescenceThicknessMap:vt,sheen:E,sheenColorMap:Ot,sheenRoughnessMap:Yt,specularMap:Vt,specularColorMap:Ft,specularIntensityMap:re,transmission:tt,transmissionMap:ce,thicknessMap:ve,gradientMap:Z,opaque:T.transparent===!1&&T.blending===No&&T.alphaToCoverage===!1,alphaMap:Nt,alphaTest:yt,alphaHash:It,combine:T.combine,mapUv:Pe&&b(T.map.channel),aoMapUv:Rt&&b(T.aoMap.channel),lightMapUv:wt&&b(T.lightMap.channel),bumpMapUv:kt&&b(T.bumpMap.channel),normalMapUv:Gt&&b(T.normalMap.channel),displacementMapUv:le&&b(T.displacementMap.channel),emissiveMapUv:ne&&b(T.emissiveMap.channel),metalnessMapUv:he&&b(T.metalnessMap.channel),roughnessMapUv:xe&&b(T.roughnessMap.channel),anisotropyMapUv:ot&&b(T.anisotropyMap.channel),clearcoatMapUv:gt&&b(T.clearcoatMap.channel),clearcoatNormalMapUv:Dt&&b(T.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Bt&&b(T.clearcoatRoughnessMap.channel),iridescenceMapUv:pt&&b(T.iridescenceMap.channel),iridescenceThicknessMapUv:vt&&b(T.iridescenceThicknessMap.channel),sheenColorMapUv:Ot&&b(T.sheenColorMap.channel),sheenRoughnessMapUv:Yt&&b(T.sheenRoughnessMap.channel),specularMapUv:Vt&&b(T.specularMap.channel),specularColorMapUv:Ft&&b(T.specularColorMap.channel),specularIntensityMapUv:re&&b(T.specularIntensityMap.channel),transmissionMapUv:ce&&b(T.transmissionMap.channel),thicknessMapUv:ve&&b(T.thicknessMap.channel),alphaMapUv:Nt&&b(T.alphaMap.channel),vertexTangents:!!J.attributes.tangent&&(Gt||W),vertexNormals:!!J.attributes.normal,vertexColors:T.vertexColors,vertexAlphas:T.vertexColors===!0&&!!J.attributes.color&&J.attributes.color.itemSize===4,pointsUvs:K.isPoints===!0&&!!J.attributes.uv&&(Pe||Nt),fog:!!dt,useFog:T.fog===!0,fogExp2:!!dt&&dt.isFogExp2,flatShading:T.wireframe===!1&&(T.flatShading===!0||J.attributes.normal===void 0&&Gt===!1&&(T.isMeshLambertMaterial||T.isMeshPhongMaterial||T.isMeshStandardMaterial||T.isMeshPhysicalMaterial)),sizeAttenuation:T.sizeAttenuation===!0,logarithmicDepthBuffer:_,reversedDepthBuffer:zt,skinning:K.isSkinnedMesh===!0,hasPositionAttribute:J.attributes.position!==void 0,morphTargets:J.morphAttributes.position!==void 0,morphNormals:J.morphAttributes.normal!==void 0,morphColors:J.morphAttributes.color!==void 0,morphTargetsCount:X,morphTextureStride:_t,numDirLights:P.directional.length,numPointLights:P.point.length,numSpotLights:P.spot.length,numSpotLightMaps:P.spotLightMap.length,numRectAreaLights:P.rectArea.length,numHemiLights:P.hemi.length,numDirLightShadows:P.directionalShadowMap.length,numPointLightShadows:P.pointShadowMap.length,numSpotLightShadows:P.spotShadowMap.length,numSpotLightShadowsWithMaps:P.numSpotLightShadowsWithMaps,numLightProbes:P.numLightProbes,numLightProbeGrids:ft.length,numClippingPlanes:l.numPlanes,numClipIntersection:l.numIntersection,dithering:T.dithering,shadowMapEnabled:s.shadowMap.enabled&&k.length>0,shadowMapType:s.shadowMap.type,toneMapping:At,decodeVideoTexture:Pe&&T.map.isVideoTexture===!0&&Ie.getTransfer(T.map.colorSpace)===Je,decodeVideoTextureEmissive:ne&&T.emissiveMap.isVideoTexture===!0&&Ie.getTransfer(T.emissiveMap.colorSpace)===Je,premultipliedAlpha:T.premultipliedAlpha,doubleSided:T.side===$i,flipSided:T.side===ni,useDepthPacking:T.depthPacking>=0,depthPacking:T.depthPacking||0,index0AttributeName:T.index0AttributeName,extensionClipCullDistance:qt&&T.extensions.clipCullDistance===!0&&e.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(qt&&T.extensions.multiDraw===!0||ae)&&e.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:e.has("KHR_parallel_shader_compile"),customProgramCacheKey:T.customProgramCacheKey()};return ee.vertexUv1s=d.has(1),ee.vertexUv2s=d.has(2),ee.vertexUv3s=d.has(3),d.clear(),ee}function M(T){const P=[];if(T.shaderID?P.push(T.shaderID):(P.push(T.customVertexShaderID),P.push(T.customFragmentShaderID)),T.defines!==void 0)for(const k in T.defines)P.push(k),P.push(T.defines[k]);return T.isRawShaderMaterial===!1&&(y(P,T),I(P,T),P.push(s.outputColorSpace)),P.push(T.customProgramCacheKey),P.join()}function y(T,P){T.push(P.precision),T.push(P.outputColorSpace),T.push(P.envMapMode),T.push(P.envMapCubeUVHeight),T.push(P.mapUv),T.push(P.alphaMapUv),T.push(P.lightMapUv),T.push(P.aoMapUv),T.push(P.bumpMapUv),T.push(P.normalMapUv),T.push(P.displacementMapUv),T.push(P.emissiveMapUv),T.push(P.metalnessMapUv),T.push(P.roughnessMapUv),T.push(P.anisotropyMapUv),T.push(P.clearcoatMapUv),T.push(P.clearcoatNormalMapUv),T.push(P.clearcoatRoughnessMapUv),T.push(P.iridescenceMapUv),T.push(P.iridescenceThicknessMapUv),T.push(P.sheenColorMapUv),T.push(P.sheenRoughnessMapUv),T.push(P.specularMapUv),T.push(P.specularColorMapUv),T.push(P.specularIntensityMapUv),T.push(P.transmissionMapUv),T.push(P.thicknessMapUv),T.push(P.combine),T.push(P.fogExp2),T.push(P.sizeAttenuation),T.push(P.morphTargetsCount),T.push(P.morphAttributeCount),T.push(P.numDirLights),T.push(P.numPointLights),T.push(P.numSpotLights),T.push(P.numSpotLightMaps),T.push(P.numHemiLights),T.push(P.numRectAreaLights),T.push(P.numDirLightShadows),T.push(P.numPointLightShadows),T.push(P.numSpotLightShadows),T.push(P.numSpotLightShadowsWithMaps),T.push(P.numLightProbes),T.push(P.shadowMapType),T.push(P.toneMapping),T.push(P.numClippingPlanes),T.push(P.numClipIntersection),T.push(P.depthPacking)}function I(T,P){u.disableAll(),P.instancing&&u.enable(0),P.instancingColor&&u.enable(1),P.instancingMorph&&u.enable(2),P.matcap&&u.enable(3),P.envMap&&u.enable(4),P.normalMapObjectSpace&&u.enable(5),P.normalMapTangentSpace&&u.enable(6),P.clearcoat&&u.enable(7),P.iridescence&&u.enable(8),P.alphaTest&&u.enable(9),P.vertexColors&&u.enable(10),P.vertexAlphas&&u.enable(11),P.vertexUv1s&&u.enable(12),P.vertexUv2s&&u.enable(13),P.vertexUv3s&&u.enable(14),P.vertexTangents&&u.enable(15),P.anisotropy&&u.enable(16),P.alphaHash&&u.enable(17),P.batching&&u.enable(18),P.dispersion&&u.enable(19),P.batchingColor&&u.enable(20),P.gradientMap&&u.enable(21),P.packedNormalMap&&u.enable(22),P.vertexNormals&&u.enable(23),T.push(u.mask),u.disableAll(),P.fog&&u.enable(0),P.useFog&&u.enable(1),P.flatShading&&u.enable(2),P.logarithmicDepthBuffer&&u.enable(3),P.reversedDepthBuffer&&u.enable(4),P.skinning&&u.enable(5),P.morphTargets&&u.enable(6),P.morphNormals&&u.enable(7),P.morphColors&&u.enable(8),P.premultipliedAlpha&&u.enable(9),P.shadowMapEnabled&&u.enable(10),P.doubleSided&&u.enable(11),P.flipSided&&u.enable(12),P.useDepthPacking&&u.enable(13),P.dithering&&u.enable(14),P.transmission&&u.enable(15),P.sheen&&u.enable(16),P.opaque&&u.enable(17),P.pointsUvs&&u.enable(18),P.decodeVideoTexture&&u.enable(19),P.decodeVideoTextureEmissive&&u.enable(20),P.alphaToCoverage&&u.enable(21),P.numLightProbeGrids>0&&u.enable(22),P.hasPositionAttribute&&u.enable(23),T.push(u.mask)}function D(T){const P=x[T.type];let k;if(P){const H=ua[P];k=J1.clone(H.uniforms)}else k=T.uniforms;return k}function A(T,P){let k=g.get(P);return k!==void 0?++k.usedTimes:(k=new U3(s,P,T,o),p.push(k),g.set(P,k)),k}function O(T){if(--T.usedTimes===0){const P=p.indexOf(T);p[P]=p[p.length-1],p.pop(),g.delete(T.cacheKey),T.destroy()}}function U(T){h.remove(T)}function z(){h.dispose()}return{getParameters:C,getProgramCacheKey:M,getUniforms:D,acquireProgram:A,releaseProgram:O,releaseShaderCache:U,programs:p,dispose:z}}function I3(){let s=new WeakMap;function t(u){return s.has(u)}function e(u){let h=s.get(u);return h===void 0&&(h={},s.set(u,h)),h}function a(u){s.delete(u)}function o(u,h,d){s.get(u)[h]=d}function l(){s=new WeakMap}return{has:t,get:e,remove:a,update:o,dispose:l}}function z3(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.material.id!==t.material.id?s.material.id-t.material.id:s.materialVariant!==t.materialVariant?s.materialVariant-t.materialVariant:s.z!==t.z?s.z-t.z:s.id-t.id}function _y(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.z!==t.z?t.z-s.z:s.id-t.id}function xy(){const s=[];let t=0;const e=[],a=[],o=[];function l(){t=0,e.length=0,a.length=0,o.length=0}function u(v){let x=0;return v.isInstancedMesh&&(x+=2),v.isSkinnedMesh&&(x+=1),x}function h(v,x,b,C,M,y){let I=s[t];return I===void 0?(I={id:v.id,object:v,geometry:x,material:b,materialVariant:u(v),groupOrder:C,renderOrder:v.renderOrder,z:M,group:y},s[t]=I):(I.id=v.id,I.object=v,I.geometry=x,I.material=b,I.materialVariant=u(v),I.groupOrder=C,I.renderOrder=v.renderOrder,I.z=M,I.group=y),t++,I}function d(v,x,b,C,M,y){const I=h(v,x,b,C,M,y);b.transmission>0?a.push(I):b.transparent===!0?o.push(I):e.push(I)}function p(v,x,b,C,M,y){const I=h(v,x,b,C,M,y);b.transmission>0?a.unshift(I):b.transparent===!0?o.unshift(I):e.unshift(I)}function g(v,x,b){e.length>1&&e.sort(v||z3),a.length>1&&a.sort(x||_y),o.length>1&&o.sort(x||_y),b&&(e.reverse(),a.reverse(),o.reverse())}function _(){for(let v=t,x=s.length;v<x;v++){const b=s[v];if(b.id===null)break;b.id=null,b.object=null,b.geometry=null,b.material=null,b.group=null}}return{opaque:e,transmissive:a,transparent:o,init:l,push:d,unshift:p,finish:_,sort:g}}function F3(){let s=new WeakMap;function t(a,o){const l=s.get(a);let u;return l===void 0?(u=new xy,s.set(a,[u])):o>=l.length?(u=new xy,l.push(u)):u=l[o],u}function e(){s=new WeakMap}return{get:t,dispose:e}}function H3(){const s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new q,color:new pe};break;case"SpotLight":e={position:new q,direction:new q,color:new pe,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new q,color:new pe,distance:0,decay:0};break;case"HemisphereLight":e={direction:new q,skyColor:new pe,groundColor:new pe};break;case"RectAreaLight":e={color:new pe,position:new q,halfWidth:new q,halfHeight:new q};break}return s[t.id]=e,e}}}function G3(){const s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ut};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ut};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ut,shadowCameraNear:1,shadowCameraFar:1e3};break}return s[t.id]=e,e}}}let V3=0;function k3(s,t){return(t.castShadow?2:0)-(s.castShadow?2:0)+(t.map?1:0)-(s.map?1:0)}function X3(s){const t=new H3,e=G3(),a={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let p=0;p<9;p++)a.probe.push(new q);const o=new q,l=new en,u=new en;function h(p){let g=0,_=0,v=0;for(let P=0;P<9;P++)a.probe[P].set(0,0,0);let x=0,b=0,C=0,M=0,y=0,I=0,D=0,A=0,O=0,U=0,z=0;p.sort(k3);for(let P=0,k=p.length;P<k;P++){const H=p[P],K=H.color,ft=H.intensity,dt=H.distance;let J=null;if(H.shadow&&H.shadow.map&&(H.shadow.map.texture.format===Sr?J=H.shadow.map.texture:J=H.shadow.map.depthTexture||H.shadow.map.texture),H.isAmbientLight)g+=K.r*ft,_+=K.g*ft,v+=K.b*ft;else if(H.isLightProbe){for(let F=0;F<9;F++)a.probe[F].addScaledVector(H.sh.coefficients[F],ft);z++}else if(H.isDirectionalLight){const F=t.get(H);if(F.color.copy(H.color).multiplyScalar(H.intensity),H.castShadow){const N=H.shadow,V=e.get(H);V.shadowIntensity=N.intensity,V.shadowBias=N.bias,V.shadowNormalBias=N.normalBias,V.shadowRadius=N.radius,V.shadowMapSize=N.mapSize,a.directionalShadow[x]=V,a.directionalShadowMap[x]=J,a.directionalShadowMatrix[x]=H.shadow.matrix,I++}a.directional[x]=F,x++}else if(H.isSpotLight){const F=t.get(H);F.position.setFromMatrixPosition(H.matrixWorld),F.color.copy(K).multiplyScalar(ft),F.distance=dt,F.coneCos=Math.cos(H.angle),F.penumbraCos=Math.cos(H.angle*(1-H.penumbra)),F.decay=H.decay,a.spot[C]=F;const N=H.shadow;if(H.map&&(a.spotLightMap[O]=H.map,O++,N.updateMatrices(H),H.castShadow&&U++),a.spotLightMatrix[C]=N.matrix,H.castShadow){const V=e.get(H);V.shadowIntensity=N.intensity,V.shadowBias=N.bias,V.shadowNormalBias=N.normalBias,V.shadowRadius=N.radius,V.shadowMapSize=N.mapSize,a.spotShadow[C]=V,a.spotShadowMap[C]=J,A++}C++}else if(H.isRectAreaLight){const F=t.get(H);F.color.copy(K).multiplyScalar(ft),F.halfWidth.set(H.width*.5,0,0),F.halfHeight.set(0,H.height*.5,0),a.rectArea[M]=F,M++}else if(H.isPointLight){const F=t.get(H);if(F.color.copy(H.color).multiplyScalar(H.intensity),F.distance=H.distance,F.decay=H.decay,H.castShadow){const N=H.shadow,V=e.get(H);V.shadowIntensity=N.intensity,V.shadowBias=N.bias,V.shadowNormalBias=N.normalBias,V.shadowRadius=N.radius,V.shadowMapSize=N.mapSize,V.shadowCameraNear=N.camera.near,V.shadowCameraFar=N.camera.far,a.pointShadow[b]=V,a.pointShadowMap[b]=J,a.pointShadowMatrix[b]=H.shadow.matrix,D++}a.point[b]=F,b++}else if(H.isHemisphereLight){const F=t.get(H);F.skyColor.copy(H.color).multiplyScalar(ft),F.groundColor.copy(H.groundColor).multiplyScalar(ft),a.hemi[y]=F,y++}}M>0&&(s.has("OES_texture_float_linear")===!0?(a.rectAreaLTC1=Wt.LTC_FLOAT_1,a.rectAreaLTC2=Wt.LTC_FLOAT_2):(a.rectAreaLTC1=Wt.LTC_HALF_1,a.rectAreaLTC2=Wt.LTC_HALF_2)),a.ambient[0]=g,a.ambient[1]=_,a.ambient[2]=v;const T=a.hash;(T.directionalLength!==x||T.pointLength!==b||T.spotLength!==C||T.rectAreaLength!==M||T.hemiLength!==y||T.numDirectionalShadows!==I||T.numPointShadows!==D||T.numSpotShadows!==A||T.numSpotMaps!==O||T.numLightProbes!==z)&&(a.directional.length=x,a.spot.length=C,a.rectArea.length=M,a.point.length=b,a.hemi.length=y,a.directionalShadow.length=I,a.directionalShadowMap.length=I,a.pointShadow.length=D,a.pointShadowMap.length=D,a.spotShadow.length=A,a.spotShadowMap.length=A,a.directionalShadowMatrix.length=I,a.pointShadowMatrix.length=D,a.spotLightMatrix.length=A+O-U,a.spotLightMap.length=O,a.numSpotLightShadowsWithMaps=U,a.numLightProbes=z,T.directionalLength=x,T.pointLength=b,T.spotLength=C,T.rectAreaLength=M,T.hemiLength=y,T.numDirectionalShadows=I,T.numPointShadows=D,T.numSpotShadows=A,T.numSpotMaps=O,T.numLightProbes=z,a.version=V3++)}function d(p,g){let _=0,v=0,x=0,b=0,C=0;const M=g.matrixWorldInverse;for(let y=0,I=p.length;y<I;y++){const D=p[y];if(D.isDirectionalLight){const A=a.directional[_];A.direction.setFromMatrixPosition(D.matrixWorld),o.setFromMatrixPosition(D.target.matrixWorld),A.direction.sub(o),A.direction.transformDirection(M),_++}else if(D.isSpotLight){const A=a.spot[x];A.position.setFromMatrixPosition(D.matrixWorld),A.position.applyMatrix4(M),A.direction.setFromMatrixPosition(D.matrixWorld),o.setFromMatrixPosition(D.target.matrixWorld),A.direction.sub(o),A.direction.transformDirection(M),x++}else if(D.isRectAreaLight){const A=a.rectArea[b];A.position.setFromMatrixPosition(D.matrixWorld),A.position.applyMatrix4(M),u.identity(),l.copy(D.matrixWorld),l.premultiply(M),u.extractRotation(l),A.halfWidth.set(D.width*.5,0,0),A.halfHeight.set(0,D.height*.5,0),A.halfWidth.applyMatrix4(u),A.halfHeight.applyMatrix4(u),b++}else if(D.isPointLight){const A=a.point[v];A.position.setFromMatrixPosition(D.matrixWorld),A.position.applyMatrix4(M),v++}else if(D.isHemisphereLight){const A=a.hemi[C];A.direction.setFromMatrixPosition(D.matrixWorld),A.direction.transformDirection(M),C++}}}return{setup:h,setupView:d,state:a}}function yy(s){const t=new X3(s),e=[],a=[],o=[];function l(v){_.camera=v,e.length=0,a.length=0,o.length=0}function u(v){e.push(v)}function h(v){a.push(v)}function d(v){o.push(v)}function p(){t.setup(e)}function g(v){t.setupView(e,v)}const _={lightsArray:e,shadowsArray:a,lightProbeGridArray:o,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:l,state:_,setupLights:p,setupLightsView:g,pushLight:u,pushShadow:h,pushLightProbeGrid:d}}function W3(s){let t=new WeakMap;function e(o,l=0){const u=t.get(o);let h;return u===void 0?(h=new yy(s),t.set(o,[h])):l>=u.length?(h=new yy(s),u.push(h)):h=u[l],h}function a(){t=new WeakMap}return{get:e,dispose:a}}const q3=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Y3=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,Z3=[new q(1,0,0),new q(-1,0,0),new q(0,1,0),new q(0,-1,0),new q(0,0,1),new q(0,0,-1)],K3=[new q(0,-1,0),new q(0,-1,0),new q(0,0,1),new q(0,0,-1),new q(0,-1,0),new q(0,-1,0)],Sy=new en,Zl=new q,Sp=new q;function J3(s,t,e){let a=new Jm;const o=new Ut,l=new Ut,u=new pn,h=new eT,d=new nT,p={},g=e.maxTextureSize,_={[Fs]:ni,[ni]:Fs,[$i]:$i},v=new Ui({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ut},radius:{value:4}},vertexShader:q3,fragmentShader:Y3}),x=v.clone();x.defines.HORIZONTAL_PASS=1;const b=new li;b.setAttribute("position",new ki(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const C=new Ge(b,v),M=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=tf;let y=this.type;this.render=function(U,z,T){if(M.enabled===!1||M.autoUpdate===!1&&M.needsUpdate===!1||U.length===0)return;this.type===Uy&&(ge("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."),this.type=tf);const P=s.getRenderTarget(),k=s.getActiveCubeFace(),H=s.getActiveMipmapLevel(),K=s.state;K.setBlending(Za),K.buffers.depth.getReversed()===!0?K.buffers.color.setClear(0,0,0,0):K.buffers.color.setClear(1,1,1,1),K.buffers.depth.setTest(!0),K.setScissorTest(!1);const ft=y!==this.type;ft&&z.traverse(function(dt){dt.material&&(Array.isArray(dt.material)?dt.material.forEach(J=>J.needsUpdate=!0):dt.material.needsUpdate=!0)});for(let dt=0,J=U.length;dt<J;dt++){const F=U[dt],N=F.shadow;if(N===void 0){ge("WebGLShadowMap:",F,"has no shadow.");continue}if(N.autoUpdate===!1&&N.needsUpdate===!1)continue;o.copy(N.mapSize);const V=N.getFrameExtents();o.multiply(V),l.copy(N.mapSize),(o.x>g||o.y>g)&&(o.x>g&&(l.x=Math.floor(g/V.x),o.x=l.x*V.x,N.mapSize.x=l.x),o.y>g&&(l.y=Math.floor(g/V.y),o.y=l.y*V.y,N.mapSize.y=l.y));const nt=s.state.buffers.depth.getReversed();if(N.camera._reversedDepth=nt,N.map===null||ft===!0){if(N.map!==null&&(N.map.depthTexture!==null&&(N.map.depthTexture.dispose(),N.map.depthTexture=null),N.map.dispose()),this.type===Kl){if(F.isPointLight){ge("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}N.map=new ma(o.x,o.y,{format:Sr,type:$a,minFilter:ei,magFilter:ei,generateMipmaps:!1}),N.map.texture.name=F.name+".shadowMap",N.map.depthTexture=new Ho(o.x,o.y,ji),N.map.depthTexture.name=F.name+".shadowMapDepth",N.map.depthTexture.format=ja,N.map.depthTexture.compareFunction=null,N.map.depthTexture.minFilter=qn,N.map.depthTexture.magFilter=qn}else F.isPointLight?(N.map=new xS(o.x),N.map.depthTexture=new v1(o.x,ga)):(N.map=new ma(o.x,o.y),N.map.depthTexture=new Ho(o.x,o.y,ga)),N.map.depthTexture.name=F.name+".shadowMap",N.map.depthTexture.format=ja,this.type===tf?(N.map.depthTexture.compareFunction=nt?Wm:Xm,N.map.depthTexture.minFilter=ei,N.map.depthTexture.magFilter=ei):(N.map.depthTexture.compareFunction=null,N.map.depthTexture.minFilter=qn,N.map.depthTexture.magFilter=qn);N.camera.updateProjectionMatrix()}const mt=N.map.isWebGLCubeRenderTarget?6:1;for(let L=0;L<mt;L++){if(N.map.isWebGLCubeRenderTarget)s.setRenderTarget(N.map,L),s.clear();else{L===0&&(s.setRenderTarget(N.map),s.clear());const X=N.getViewport(L);u.set(l.x*X.x,l.y*X.y,l.x*X.z,l.y*X.w),K.viewport(u)}if(F.isPointLight){const X=N.camera,_t=N.matrix,Ct=F.distance||X.far;Ct!==X.far&&(X.far=Ct,X.updateProjectionMatrix()),Zl.setFromMatrixPosition(F.matrixWorld),X.position.copy(Zl),Sp.copy(X.position),Sp.add(Z3[L]),X.up.copy(K3[L]),X.lookAt(Sp),X.updateMatrixWorld(),_t.makeTranslation(-Zl.x,-Zl.y,-Zl.z),Sy.multiplyMatrices(X.projectionMatrix,X.matrixWorldInverse),N._frustum.setFromProjectionMatrix(Sy,X.coordinateSystem,X.reversedDepth)}else N.updateMatrices(F);a=N.getFrustum(),A(z,T,N.camera,F,this.type)}N.isPointLightShadow!==!0&&this.type===Kl&&I(N,T),N.needsUpdate=!1}y=this.type,M.needsUpdate=!1,s.setRenderTarget(P,k,H)};function I(U,z){const T=t.update(C);v.defines.VSM_SAMPLES!==U.blurSamples&&(v.defines.VSM_SAMPLES=U.blurSamples,x.defines.VSM_SAMPLES=U.blurSamples,v.needsUpdate=!0,x.needsUpdate=!0),U.mapPass===null&&(U.mapPass=new ma(o.x,o.y,{format:Sr,type:$a})),v.uniforms.shadow_pass.value=U.map.depthTexture,v.uniforms.resolution.value=U.mapSize,v.uniforms.radius.value=U.radius,s.setRenderTarget(U.mapPass),s.clear(),s.renderBufferDirect(z,null,T,v,C,null),x.uniforms.shadow_pass.value=U.mapPass.texture,x.uniforms.resolution.value=U.mapSize,x.uniforms.radius.value=U.radius,s.setRenderTarget(U.map),s.clear(),s.renderBufferDirect(z,null,T,x,C,null)}function D(U,z,T,P){let k=null;const H=T.isPointLight===!0?U.customDistanceMaterial:U.customDepthMaterial;if(H!==void 0)k=H;else if(k=T.isPointLight===!0?d:h,s.localClippingEnabled&&z.clipShadows===!0&&Array.isArray(z.clippingPlanes)&&z.clippingPlanes.length!==0||z.displacementMap&&z.displacementScale!==0||z.alphaMap&&z.alphaTest>0||z.map&&z.alphaTest>0||z.alphaToCoverage===!0){const K=k.uuid,ft=z.uuid;let dt=p[K];dt===void 0&&(dt={},p[K]=dt);let J=dt[ft];J===void 0&&(J=k.clone(),dt[ft]=J,z.addEventListener("dispose",O)),k=J}if(k.visible=z.visible,k.wireframe=z.wireframe,P===Kl?k.side=z.shadowSide!==null?z.shadowSide:z.side:k.side=z.shadowSide!==null?z.shadowSide:_[z.side],k.alphaMap=z.alphaMap,k.alphaTest=z.alphaToCoverage===!0?.5:z.alphaTest,k.map=z.map,k.clipShadows=z.clipShadows,k.clippingPlanes=z.clippingPlanes,k.clipIntersection=z.clipIntersection,k.displacementMap=z.displacementMap,k.displacementScale=z.displacementScale,k.displacementBias=z.displacementBias,k.wireframeLinewidth=z.wireframeLinewidth,k.linewidth=z.linewidth,T.isPointLight===!0&&k.isMeshDistanceMaterial===!0){const K=s.properties.get(k);K.light=T}return k}function A(U,z,T,P,k){if(U.visible===!1)return;if(U.layers.test(z.layers)&&(U.isMesh||U.isLine||U.isPoints)&&(U.castShadow||U.receiveShadow&&k===Kl)&&(!U.frustumCulled||a.intersectsObject(U))){U.modelViewMatrix.multiplyMatrices(T.matrixWorldInverse,U.matrixWorld);const ft=t.update(U),dt=U.material;if(Array.isArray(dt)){const J=ft.groups;for(let F=0,N=J.length;F<N;F++){const V=J[F],nt=dt[V.materialIndex];if(nt&&nt.visible){const mt=D(U,nt,P,k);U.onBeforeShadow(s,U,z,T,ft,mt,V),s.renderBufferDirect(T,null,ft,mt,U,V),U.onAfterShadow(s,U,z,T,ft,mt,V)}}}else if(dt.visible){const J=D(U,dt,P,k);U.onBeforeShadow(s,U,z,T,ft,J,null),s.renderBufferDirect(T,null,ft,J,U,null),U.onAfterShadow(s,U,z,T,ft,J,null)}}const K=U.children;for(let ft=0,dt=K.length;ft<dt;ft++)A(K[ft],z,T,P,k)}function O(U){U.target.removeEventListener("dispose",O);for(const T in p){const P=p[T],k=U.target.uuid;k in P&&(P[k].dispose(),delete P[k])}}}function Q3(s,t){function e(){let Z=!1;const Nt=new pn;let yt=null;const It=new pn(0,0,0,0);return{setMask:function(qt){yt!==qt&&!Z&&(s.colorMask(qt,qt,qt,qt),yt=qt)},setLocked:function(qt){Z=qt},setClear:function(qt,At,ee,Qt,cn){cn===!0&&(qt*=Qt,At*=Qt,ee*=Qt),Nt.set(qt,At,ee,Qt),It.equals(Nt)===!1&&(s.clearColor(qt,At,ee,Qt),It.copy(Nt))},reset:function(){Z=!1,yt=null,It.set(-1,0,0,0)}}}function a(){let Z=!1,Nt=!1,yt=null,It=null,qt=null;return{setReversed:function(At){if(Nt!==At){const ee=t.get("EXT_clip_control");At?ee.clipControlEXT(ee.LOWER_LEFT_EXT,ee.ZERO_TO_ONE_EXT):ee.clipControlEXT(ee.LOWER_LEFT_EXT,ee.NEGATIVE_ONE_TO_ONE_EXT),Nt=At;const Qt=qt;qt=null,this.setClear(Qt)}},getReversed:function(){return Nt},setTest:function(At){At?Et(s.DEPTH_TEST):zt(s.DEPTH_TEST)},setMask:function(At){yt!==At&&!Z&&(s.depthMask(At),yt=At)},setFunc:function(At){if(Nt&&(At=qE[At]),It!==At){switch(At){case Cp:s.depthFunc(s.NEVER);break;case Dp:s.depthFunc(s.ALWAYS);break;case Up:s.depthFunc(s.LESS);break;case Io:s.depthFunc(s.LEQUAL);break;case Lp:s.depthFunc(s.EQUAL);break;case Np:s.depthFunc(s.GEQUAL);break;case Op:s.depthFunc(s.GREATER);break;case Pp:s.depthFunc(s.NOTEQUAL);break;default:s.depthFunc(s.LEQUAL)}It=At}},setLocked:function(At){Z=At},setClear:function(At){qt!==At&&(qt=At,Nt&&(At=1-At),s.clearDepth(At))},reset:function(){Z=!1,yt=null,It=null,qt=null,Nt=!1}}}function o(){let Z=!1,Nt=null,yt=null,It=null,qt=null,At=null,ee=null,Qt=null,cn=null;return{setTest:function(Xe){Z||(Xe?Et(s.STENCIL_TEST):zt(s.STENCIL_TEST))},setMask:function(Xe){Nt!==Xe&&!Z&&(s.stencilMask(Xe),Nt=Xe)},setFunc:function(Xe,gi,vi){(yt!==Xe||It!==gi||qt!==vi)&&(s.stencilFunc(Xe,gi,vi),yt=Xe,It=gi,qt=vi)},setOp:function(Xe,gi,vi){(At!==Xe||ee!==gi||Qt!==vi)&&(s.stencilOp(Xe,gi,vi),At=Xe,ee=gi,Qt=vi)},setLocked:function(Xe){Z=Xe},setClear:function(Xe){cn!==Xe&&(s.clearStencil(Xe),cn=Xe)},reset:function(){Z=!1,Nt=null,yt=null,It=null,qt=null,At=null,ee=null,Qt=null,cn=null}}}const l=new e,u=new a,h=new o,d=new WeakMap,p=new WeakMap;let g={},_={},v={},x=new WeakMap,b=[],C=null,M=!1,y=null,I=null,D=null,A=null,O=null,U=null,z=null,T=new pe(0,0,0),P=0,k=!1,H=null,K=null,ft=null,dt=null,J=null;const F=s.getParameter(s.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let N=!1,V=0;const nt=s.getParameter(s.VERSION);nt.indexOf("WebGL")!==-1?(V=parseFloat(/^WebGL (\d)/.exec(nt)[1]),N=V>=1):nt.indexOf("OpenGL ES")!==-1&&(V=parseFloat(/^OpenGL ES (\d)/.exec(nt)[1]),N=V>=2);let mt=null,L={};const X=s.getParameter(s.SCISSOR_BOX),_t=s.getParameter(s.VIEWPORT),Ct=new pn().fromArray(X),Lt=new pn().fromArray(_t);function et(Z,Nt,yt,It){const qt=new Uint8Array(4),At=s.createTexture();s.bindTexture(Z,At),s.texParameteri(Z,s.TEXTURE_MIN_FILTER,s.NEAREST),s.texParameteri(Z,s.TEXTURE_MAG_FILTER,s.NEAREST);for(let ee=0;ee<yt;ee++)Z===s.TEXTURE_3D||Z===s.TEXTURE_2D_ARRAY?s.texImage3D(Nt,0,s.RGBA,1,1,It,0,s.RGBA,s.UNSIGNED_BYTE,qt):s.texImage2D(Nt+ee,0,s.RGBA,1,1,0,s.RGBA,s.UNSIGNED_BYTE,qt);return At}const Mt={};Mt[s.TEXTURE_2D]=et(s.TEXTURE_2D,s.TEXTURE_2D,1),Mt[s.TEXTURE_CUBE_MAP]=et(s.TEXTURE_CUBE_MAP,s.TEXTURE_CUBE_MAP_POSITIVE_X,6),Mt[s.TEXTURE_2D_ARRAY]=et(s.TEXTURE_2D_ARRAY,s.TEXTURE_2D_ARRAY,1,1),Mt[s.TEXTURE_3D]=et(s.TEXTURE_3D,s.TEXTURE_3D,1,1),l.setClear(0,0,0,1),u.setClear(1),h.setClear(0),Et(s.DEPTH_TEST),u.setFunc(Io),kt(!1),Gt(cx),Et(s.CULL_FACE),Rt(Za);function Et(Z){g[Z]!==!0&&(s.enable(Z),g[Z]=!0)}function zt(Z){g[Z]!==!1&&(s.disable(Z),g[Z]=!1)}function oe(Z,Nt){return v[Z]!==Nt?(s.bindFramebuffer(Z,Nt),v[Z]=Nt,Z===s.DRAW_FRAMEBUFFER&&(v[s.FRAMEBUFFER]=Nt),Z===s.FRAMEBUFFER&&(v[s.DRAW_FRAMEBUFFER]=Nt),!0):!1}function ae(Z,Nt){let yt=b,It=!1;if(Z){yt=x.get(Nt),yt===void 0&&(yt=[],x.set(Nt,yt));const qt=Z.textures;if(yt.length!==qt.length||yt[0]!==s.COLOR_ATTACHMENT0){for(let At=0,ee=qt.length;At<ee;At++)yt[At]=s.COLOR_ATTACHMENT0+At;yt.length=qt.length,It=!0}}else yt[0]!==s.BACK&&(yt[0]=s.BACK,It=!0);It&&s.drawBuffers(yt)}function Pe(Z){return C!==Z?(s.useProgram(Z),C=Z,!0):!1}const me={[pr]:s.FUNC_ADD,[mE]:s.FUNC_SUBTRACT,[gE]:s.FUNC_REVERSE_SUBTRACT};me[vE]=s.MIN,me[_E]=s.MAX;const Tt={[xE]:s.ZERO,[yE]:s.ONE,[SE]:s.SRC_COLOR,[wp]:s.SRC_ALPHA,[wE]:s.SRC_ALPHA_SATURATE,[TE]:s.DST_COLOR,[bE]:s.DST_ALPHA,[ME]:s.ONE_MINUS_SRC_COLOR,[Rp]:s.ONE_MINUS_SRC_ALPHA,[AE]:s.ONE_MINUS_DST_COLOR,[EE]:s.ONE_MINUS_DST_ALPHA,[RE]:s.CONSTANT_COLOR,[CE]:s.ONE_MINUS_CONSTANT_COLOR,[DE]:s.CONSTANT_ALPHA,[UE]:s.ONE_MINUS_CONSTANT_ALPHA};function Rt(Z,Nt,yt,It,qt,At,ee,Qt,cn,Xe){if(Z===Za){M===!0&&(zt(s.BLEND),M=!1);return}if(M===!1&&(Et(s.BLEND),M=!0),Z!==pE){if(Z!==y||Xe!==k){if((I!==pr||O!==pr)&&(s.blendEquation(s.FUNC_ADD),I=pr,O=pr),Xe)switch(Z){case No:s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case ux:s.blendFunc(s.ONE,s.ONE);break;case fx:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case hx:s.blendFuncSeparate(s.DST_COLOR,s.ONE_MINUS_SRC_ALPHA,s.ZERO,s.ONE);break;default:Oe("WebGLState: Invalid blending: ",Z);break}else switch(Z){case No:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case ux:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE,s.ONE,s.ONE);break;case fx:Oe("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case hx:Oe("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:Oe("WebGLState: Invalid blending: ",Z);break}D=null,A=null,U=null,z=null,T.set(0,0,0),P=0,y=Z,k=Xe}return}qt=qt||Nt,At=At||yt,ee=ee||It,(Nt!==I||qt!==O)&&(s.blendEquationSeparate(me[Nt],me[qt]),I=Nt,O=qt),(yt!==D||It!==A||At!==U||ee!==z)&&(s.blendFuncSeparate(Tt[yt],Tt[It],Tt[At],Tt[ee]),D=yt,A=It,U=At,z=ee),(Qt.equals(T)===!1||cn!==P)&&(s.blendColor(Qt.r,Qt.g,Qt.b,cn),T.copy(Qt),P=cn),y=Z,k=!1}function wt(Z,Nt){Z.side===$i?zt(s.CULL_FACE):Et(s.CULL_FACE);let yt=Z.side===ni;Nt&&(yt=!yt),kt(yt),Z.blending===No&&Z.transparent===!1?Rt(Za):Rt(Z.blending,Z.blendEquation,Z.blendSrc,Z.blendDst,Z.blendEquationAlpha,Z.blendSrcAlpha,Z.blendDstAlpha,Z.blendColor,Z.blendAlpha,Z.premultipliedAlpha),u.setFunc(Z.depthFunc),u.setTest(Z.depthTest),u.setMask(Z.depthWrite),l.setMask(Z.colorWrite);const It=Z.stencilWrite;h.setTest(It),It&&(h.setMask(Z.stencilWriteMask),h.setFunc(Z.stencilFunc,Z.stencilRef,Z.stencilFuncMask),h.setOp(Z.stencilFail,Z.stencilZFail,Z.stencilZPass)),ne(Z.polygonOffset,Z.polygonOffsetFactor,Z.polygonOffsetUnits),Z.alphaToCoverage===!0?Et(s.SAMPLE_ALPHA_TO_COVERAGE):zt(s.SAMPLE_ALPHA_TO_COVERAGE)}function kt(Z){H!==Z&&(Z?s.frontFace(s.CW):s.frontFace(s.CCW),H=Z)}function Gt(Z){Z!==hE?(Et(s.CULL_FACE),Z!==K&&(Z===cx?s.cullFace(s.BACK):Z===dE?s.cullFace(s.FRONT):s.cullFace(s.FRONT_AND_BACK))):zt(s.CULL_FACE),K=Z}function le(Z){Z!==ft&&(N&&s.lineWidth(Z),ft=Z)}function ne(Z,Nt,yt){Z?(Et(s.POLYGON_OFFSET_FILL),(dt!==Nt||J!==yt)&&(dt=Nt,J=yt,u.getReversed()&&(Nt=-Nt),s.polygonOffset(Nt,yt))):zt(s.POLYGON_OFFSET_FILL)}function he(Z){Z?Et(s.SCISSOR_TEST):zt(s.SCISSOR_TEST)}function xe(Z){Z===void 0&&(Z=s.TEXTURE0+F-1),mt!==Z&&(s.activeTexture(Z),mt=Z)}function W(Z,Nt,yt){yt===void 0&&(mt===null?yt=s.TEXTURE0+F-1:yt=mt);let It=L[yt];It===void 0&&(It={type:void 0,texture:void 0},L[yt]=It),(It.type!==Z||It.texture!==Nt)&&(mt!==yt&&(s.activeTexture(yt),mt=yt),s.bindTexture(Z,Nt||Mt[Z]),It.type=Z,It.texture=Nt)}function Me(){const Z=L[mt];Z!==void 0&&Z.type!==void 0&&(s.bindTexture(Z.type,null),Z.type=void 0,Z.texture=void 0)}function we(){try{s.compressedTexImage2D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function B(){try{s.compressedTexImage3D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function E(){try{s.texSubImage2D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function tt(){try{s.texSubImage3D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function ot(){try{s.compressedTexSubImage2D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function gt(){try{s.compressedTexSubImage3D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function Dt(){try{s.texStorage2D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function Bt(){try{s.texStorage3D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function pt(){try{s.texImage2D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function vt(){try{s.texImage3D(...arguments)}catch(Z){Oe("WebGLState:",Z)}}function Ot(Z){return _[Z]!==void 0?_[Z]:s.getParameter(Z)}function Yt(Z,Nt){_[Z]!==Nt&&(s.pixelStorei(Z,Nt),_[Z]=Nt)}function Vt(Z){Ct.equals(Z)===!1&&(s.scissor(Z.x,Z.y,Z.z,Z.w),Ct.copy(Z))}function Ft(Z){Lt.equals(Z)===!1&&(s.viewport(Z.x,Z.y,Z.z,Z.w),Lt.copy(Z))}function re(Z,Nt){let yt=p.get(Nt);yt===void 0&&(yt=new WeakMap,p.set(Nt,yt));let It=yt.get(Z);It===void 0&&(It=s.getUniformBlockIndex(Nt,Z.name),yt.set(Z,It))}function ce(Z,Nt){const It=p.get(Nt).get(Z);d.get(Nt)!==It&&(s.uniformBlockBinding(Nt,It,Z.__bindingPointIndex),d.set(Nt,It))}function ve(){s.disable(s.BLEND),s.disable(s.CULL_FACE),s.disable(s.DEPTH_TEST),s.disable(s.POLYGON_OFFSET_FILL),s.disable(s.SCISSOR_TEST),s.disable(s.STENCIL_TEST),s.disable(s.SAMPLE_ALPHA_TO_COVERAGE),s.blendEquation(s.FUNC_ADD),s.blendFunc(s.ONE,s.ZERO),s.blendFuncSeparate(s.ONE,s.ZERO,s.ONE,s.ZERO),s.blendColor(0,0,0,0),s.colorMask(!0,!0,!0,!0),s.clearColor(0,0,0,0),s.depthMask(!0),s.depthFunc(s.LESS),u.setReversed(!1),s.clearDepth(1),s.stencilMask(4294967295),s.stencilFunc(s.ALWAYS,0,4294967295),s.stencilOp(s.KEEP,s.KEEP,s.KEEP),s.clearStencil(0),s.cullFace(s.BACK),s.frontFace(s.CCW),s.polygonOffset(0,0),s.activeTexture(s.TEXTURE0),s.bindFramebuffer(s.FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.useProgram(null),s.lineWidth(1),s.scissor(0,0,s.canvas.width,s.canvas.height),s.viewport(0,0,s.canvas.width,s.canvas.height),s.pixelStorei(s.PACK_ALIGNMENT,4),s.pixelStorei(s.UNPACK_ALIGNMENT,4),s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,!1),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,s.BROWSER_DEFAULT_WEBGL),s.pixelStorei(s.PACK_ROW_LENGTH,0),s.pixelStorei(s.PACK_SKIP_PIXELS,0),s.pixelStorei(s.PACK_SKIP_ROWS,0),s.pixelStorei(s.UNPACK_ROW_LENGTH,0),s.pixelStorei(s.UNPACK_IMAGE_HEIGHT,0),s.pixelStorei(s.UNPACK_SKIP_PIXELS,0),s.pixelStorei(s.UNPACK_SKIP_ROWS,0),s.pixelStorei(s.UNPACK_SKIP_IMAGES,0),g={},_={},mt=null,L={},v={},x=new WeakMap,b=[],C=null,M=!1,y=null,I=null,D=null,A=null,O=null,U=null,z=null,T=new pe(0,0,0),P=0,k=!1,H=null,K=null,ft=null,dt=null,J=null,Ct.set(0,0,s.canvas.width,s.canvas.height),Lt.set(0,0,s.canvas.width,s.canvas.height),l.reset(),u.reset(),h.reset()}return{buffers:{color:l,depth:u,stencil:h},enable:Et,disable:zt,bindFramebuffer:oe,drawBuffers:ae,useProgram:Pe,setBlending:Rt,setMaterial:wt,setFlipSided:kt,setCullFace:Gt,setLineWidth:le,setPolygonOffset:ne,setScissorTest:he,activeTexture:xe,bindTexture:W,unbindTexture:Me,compressedTexImage2D:we,compressedTexImage3D:B,texImage2D:pt,texImage3D:vt,pixelStorei:Yt,getParameter:Ot,updateUBOMapping:re,uniformBlockBinding:ce,texStorage2D:Dt,texStorage3D:Bt,texSubImage2D:E,texSubImage3D:tt,compressedTexSubImage2D:ot,compressedTexSubImage3D:gt,scissor:Vt,viewport:Ft,reset:ve}}function $3(s,t,e,a,o,l,u){const h=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,d=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),p=new Ut,g=new WeakMap,_=new Set;let v;const x=new WeakMap;let b=!1;try{b=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function C(B,E){return b?new OffscreenCanvas(B,E):cc("canvas")}function M(B,E,tt){let ot=1;const gt=we(B);if((gt.width>tt||gt.height>tt)&&(ot=tt/Math.max(gt.width,gt.height)),ot<1)if(typeof HTMLImageElement<"u"&&B instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&B instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&B instanceof ImageBitmap||typeof VideoFrame<"u"&&B instanceof VideoFrame){const Dt=Math.floor(ot*gt.width),Bt=Math.floor(ot*gt.height);v===void 0&&(v=C(Dt,Bt));const pt=E?C(Dt,Bt):v;return pt.width=Dt,pt.height=Bt,pt.getContext("2d").drawImage(B,0,0,Dt,Bt),ge("WebGLRenderer: Texture has been resized from ("+gt.width+"x"+gt.height+") to ("+Dt+"x"+Bt+")."),pt}else return"data"in B&&ge("WebGLRenderer: Image in DataTexture is too big ("+gt.width+"x"+gt.height+")."),B;return B}function y(B){return B.generateMipmaps}function I(B){s.generateMipmap(B)}function D(B){return B.isWebGLCubeRenderTarget?s.TEXTURE_CUBE_MAP:B.isWebGL3DRenderTarget?s.TEXTURE_3D:B.isWebGLArrayRenderTarget||B.isCompressedArrayTexture?s.TEXTURE_2D_ARRAY:s.TEXTURE_2D}function A(B,E,tt,ot,gt,Dt=!1){if(B!==null){if(s[B]!==void 0)return s[B];ge("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+B+"'")}let Bt;ot&&(Bt=t.get("EXT_texture_norm16"),Bt||ge("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension"));let pt=E;if(E===s.RED&&(tt===s.FLOAT&&(pt=s.R32F),tt===s.HALF_FLOAT&&(pt=s.R16F),tt===s.UNSIGNED_BYTE&&(pt=s.R8),tt===s.UNSIGNED_SHORT&&Bt&&(pt=Bt.R16_EXT),tt===s.SHORT&&Bt&&(pt=Bt.R16_SNORM_EXT)),E===s.RED_INTEGER&&(tt===s.UNSIGNED_BYTE&&(pt=s.R8UI),tt===s.UNSIGNED_SHORT&&(pt=s.R16UI),tt===s.UNSIGNED_INT&&(pt=s.R32UI),tt===s.BYTE&&(pt=s.R8I),tt===s.SHORT&&(pt=s.R16I),tt===s.INT&&(pt=s.R32I)),E===s.RG&&(tt===s.FLOAT&&(pt=s.RG32F),tt===s.HALF_FLOAT&&(pt=s.RG16F),tt===s.UNSIGNED_BYTE&&(pt=s.RG8),tt===s.UNSIGNED_SHORT&&Bt&&(pt=Bt.RG16_EXT),tt===s.SHORT&&Bt&&(pt=Bt.RG16_SNORM_EXT)),E===s.RG_INTEGER&&(tt===s.UNSIGNED_BYTE&&(pt=s.RG8UI),tt===s.UNSIGNED_SHORT&&(pt=s.RG16UI),tt===s.UNSIGNED_INT&&(pt=s.RG32UI),tt===s.BYTE&&(pt=s.RG8I),tt===s.SHORT&&(pt=s.RG16I),tt===s.INT&&(pt=s.RG32I)),E===s.RGB_INTEGER&&(tt===s.UNSIGNED_BYTE&&(pt=s.RGB8UI),tt===s.UNSIGNED_SHORT&&(pt=s.RGB16UI),tt===s.UNSIGNED_INT&&(pt=s.RGB32UI),tt===s.BYTE&&(pt=s.RGB8I),tt===s.SHORT&&(pt=s.RGB16I),tt===s.INT&&(pt=s.RGB32I)),E===s.RGBA_INTEGER&&(tt===s.UNSIGNED_BYTE&&(pt=s.RGBA8UI),tt===s.UNSIGNED_SHORT&&(pt=s.RGBA16UI),tt===s.UNSIGNED_INT&&(pt=s.RGBA32UI),tt===s.BYTE&&(pt=s.RGBA8I),tt===s.SHORT&&(pt=s.RGBA16I),tt===s.INT&&(pt=s.RGBA32I)),E===s.RGB&&(tt===s.UNSIGNED_SHORT&&Bt&&(pt=Bt.RGB16_EXT),tt===s.SHORT&&Bt&&(pt=Bt.RGB16_SNORM_EXT),tt===s.UNSIGNED_INT_5_9_9_9_REV&&(pt=s.RGB9_E5),tt===s.UNSIGNED_INT_10F_11F_11F_REV&&(pt=s.R11F_G11F_B10F)),E===s.RGBA){const vt=Dt?pf:Ie.getTransfer(gt);tt===s.FLOAT&&(pt=s.RGBA32F),tt===s.HALF_FLOAT&&(pt=s.RGBA16F),tt===s.UNSIGNED_BYTE&&(pt=vt===Je?s.SRGB8_ALPHA8:s.RGBA8),tt===s.UNSIGNED_SHORT&&Bt&&(pt=Bt.RGBA16_EXT),tt===s.SHORT&&Bt&&(pt=Bt.RGBA16_SNORM_EXT),tt===s.UNSIGNED_SHORT_4_4_4_4&&(pt=s.RGBA4),tt===s.UNSIGNED_SHORT_5_5_5_1&&(pt=s.RGB5_A1)}return(pt===s.R16F||pt===s.R32F||pt===s.RG16F||pt===s.RG32F||pt===s.RGBA16F||pt===s.RGBA32F)&&t.get("EXT_color_buffer_float"),pt}function O(B,E){let tt;return B?E===null||E===ga||E===oc?tt=s.DEPTH24_STENCIL8:E===ji?tt=s.DEPTH32F_STENCIL8:E===rc&&(tt=s.DEPTH24_STENCIL8,ge("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):E===null||E===ga||E===oc?tt=s.DEPTH_COMPONENT24:E===ji?tt=s.DEPTH_COMPONENT32F:E===rc&&(tt=s.DEPTH_COMPONENT16),tt}function U(B,E){return y(B)===!0||B.isFramebufferTexture&&B.minFilter!==qn&&B.minFilter!==ei?Math.log2(Math.max(E.width,E.height))+1:B.mipmaps!==void 0&&B.mipmaps.length>0?B.mipmaps.length:B.isCompressedTexture&&Array.isArray(B.image)?E.mipmaps.length:1}function z(B){const E=B.target;E.removeEventListener("dispose",z),P(E),E.isVideoTexture&&g.delete(E),E.isHTMLTexture&&_.delete(E)}function T(B){const E=B.target;E.removeEventListener("dispose",T),H(E)}function P(B){const E=a.get(B);if(E.__webglInit===void 0)return;const tt=B.source,ot=x.get(tt);if(ot){const gt=ot[E.__cacheKey];gt.usedTimes--,gt.usedTimes===0&&k(B),Object.keys(ot).length===0&&x.delete(tt)}a.remove(B)}function k(B){const E=a.get(B);s.deleteTexture(E.__webglTexture);const tt=B.source,ot=x.get(tt);delete ot[E.__cacheKey],u.memory.textures--}function H(B){const E=a.get(B);if(B.depthTexture&&(B.depthTexture.dispose(),a.remove(B.depthTexture)),B.isWebGLCubeRenderTarget)for(let ot=0;ot<6;ot++){if(Array.isArray(E.__webglFramebuffer[ot]))for(let gt=0;gt<E.__webglFramebuffer[ot].length;gt++)s.deleteFramebuffer(E.__webglFramebuffer[ot][gt]);else s.deleteFramebuffer(E.__webglFramebuffer[ot]);E.__webglDepthbuffer&&s.deleteRenderbuffer(E.__webglDepthbuffer[ot])}else{if(Array.isArray(E.__webglFramebuffer))for(let ot=0;ot<E.__webglFramebuffer.length;ot++)s.deleteFramebuffer(E.__webglFramebuffer[ot]);else s.deleteFramebuffer(E.__webglFramebuffer);if(E.__webglDepthbuffer&&s.deleteRenderbuffer(E.__webglDepthbuffer),E.__webglMultisampledFramebuffer&&s.deleteFramebuffer(E.__webglMultisampledFramebuffer),E.__webglColorRenderbuffer)for(let ot=0;ot<E.__webglColorRenderbuffer.length;ot++)E.__webglColorRenderbuffer[ot]&&s.deleteRenderbuffer(E.__webglColorRenderbuffer[ot]);E.__webglDepthRenderbuffer&&s.deleteRenderbuffer(E.__webglDepthRenderbuffer)}const tt=B.textures;for(let ot=0,gt=tt.length;ot<gt;ot++){const Dt=a.get(tt[ot]);Dt.__webglTexture&&(s.deleteTexture(Dt.__webglTexture),u.memory.textures--),a.remove(tt[ot])}a.remove(B)}let K=0;function ft(){K=0}function dt(){return K}function J(B){K=B}function F(){const B=K;return B>=o.maxTextures&&ge("WebGLTextures: Trying to use "+B+" texture units while this GPU supports only "+o.maxTextures),K+=1,B}function N(B){const E=[];return E.push(B.wrapS),E.push(B.wrapT),E.push(B.wrapR||0),E.push(B.magFilter),E.push(B.minFilter),E.push(B.anisotropy),E.push(B.internalFormat),E.push(B.format),E.push(B.type),E.push(B.generateMipmaps),E.push(B.premultiplyAlpha),E.push(B.flipY),E.push(B.unpackAlignment),E.push(B.colorSpace),E.join()}function V(B,E){const tt=a.get(B);if(B.isVideoTexture&&W(B),B.isRenderTargetTexture===!1&&B.isExternalTexture!==!0&&B.version>0&&tt.__version!==B.version){const ot=B.image;if(ot===null)ge("WebGLRenderer: Texture marked for update but no image data found.");else if(ot.complete===!1)ge("WebGLRenderer: Texture marked for update but image is incomplete");else{zt(tt,B,E);return}}else B.isExternalTexture&&(tt.__webglTexture=B.sourceTexture?B.sourceTexture:null);e.bindTexture(s.TEXTURE_2D,tt.__webglTexture,s.TEXTURE0+E)}function nt(B,E){const tt=a.get(B);if(B.isRenderTargetTexture===!1&&B.version>0&&tt.__version!==B.version){zt(tt,B,E);return}else B.isExternalTexture&&(tt.__webglTexture=B.sourceTexture?B.sourceTexture:null);e.bindTexture(s.TEXTURE_2D_ARRAY,tt.__webglTexture,s.TEXTURE0+E)}function mt(B,E){const tt=a.get(B);if(B.isRenderTargetTexture===!1&&B.version>0&&tt.__version!==B.version){zt(tt,B,E);return}e.bindTexture(s.TEXTURE_3D,tt.__webglTexture,s.TEXTURE0+E)}function L(B,E){const tt=a.get(B);if(B.isCubeDepthTexture!==!0&&B.version>0&&tt.__version!==B.version){oe(tt,B,E);return}e.bindTexture(s.TEXTURE_CUBE_MAP,tt.__webglTexture,s.TEXTURE0+E)}const X={[Fo]:s.REPEAT,[qa]:s.CLAMP_TO_EDGE,[Bp]:s.MIRRORED_REPEAT},_t={[qn]:s.NEAREST,[OE]:s.NEAREST_MIPMAP_NEAREST,[Au]:s.NEAREST_MIPMAP_LINEAR,[ei]:s.LINEAR,[Fd]:s.LINEAR_MIPMAP_NEAREST,[vr]:s.LINEAR_MIPMAP_LINEAR},Ct={[IE]:s.NEVER,[VE]:s.ALWAYS,[zE]:s.LESS,[Xm]:s.LEQUAL,[FE]:s.EQUAL,[Wm]:s.GEQUAL,[HE]:s.GREATER,[GE]:s.NOTEQUAL};function Lt(B,E){if(E.type===ji&&t.has("OES_texture_float_linear")===!1&&(E.magFilter===ei||E.magFilter===Fd||E.magFilter===Au||E.magFilter===vr||E.minFilter===ei||E.minFilter===Fd||E.minFilter===Au||E.minFilter===vr)&&ge("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),s.texParameteri(B,s.TEXTURE_WRAP_S,X[E.wrapS]),s.texParameteri(B,s.TEXTURE_WRAP_T,X[E.wrapT]),(B===s.TEXTURE_3D||B===s.TEXTURE_2D_ARRAY)&&s.texParameteri(B,s.TEXTURE_WRAP_R,X[E.wrapR]),s.texParameteri(B,s.TEXTURE_MAG_FILTER,_t[E.magFilter]),s.texParameteri(B,s.TEXTURE_MIN_FILTER,_t[E.minFilter]),E.compareFunction&&(s.texParameteri(B,s.TEXTURE_COMPARE_MODE,s.COMPARE_REF_TO_TEXTURE),s.texParameteri(B,s.TEXTURE_COMPARE_FUNC,Ct[E.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(E.magFilter===qn||E.minFilter!==Au&&E.minFilter!==vr||E.type===ji&&t.has("OES_texture_float_linear")===!1)return;if(E.anisotropy>1||a.get(E).__currentAnisotropy){const tt=t.get("EXT_texture_filter_anisotropic");s.texParameterf(B,tt.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(E.anisotropy,o.getMaxAnisotropy())),a.get(E).__currentAnisotropy=E.anisotropy}}}function et(B,E){let tt=!1;B.__webglInit===void 0&&(B.__webglInit=!0,E.addEventListener("dispose",z));const ot=E.source;let gt=x.get(ot);gt===void 0&&(gt={},x.set(ot,gt));const Dt=N(E);if(Dt!==B.__cacheKey){gt[Dt]===void 0&&(gt[Dt]={texture:s.createTexture(),usedTimes:0},u.memory.textures++,tt=!0),gt[Dt].usedTimes++;const Bt=gt[B.__cacheKey];Bt!==void 0&&(gt[B.__cacheKey].usedTimes--,Bt.usedTimes===0&&k(E)),B.__cacheKey=Dt,B.__webglTexture=gt[Dt].texture}return tt}function Mt(B,E,tt){return Math.floor(Math.floor(B/tt)/E)}function Et(B,E,tt,ot){const Dt=B.updateRanges;if(Dt.length===0)e.texSubImage2D(s.TEXTURE_2D,0,0,0,E.width,E.height,tt,ot,E.data);else{Dt.sort((Yt,Vt)=>Yt.start-Vt.start);let Bt=0;for(let Yt=1;Yt<Dt.length;Yt++){const Vt=Dt[Bt],Ft=Dt[Yt],re=Vt.start+Vt.count,ce=Mt(Ft.start,E.width,4),ve=Mt(Vt.start,E.width,4);Ft.start<=re+1&&ce===ve&&Mt(Ft.start+Ft.count-1,E.width,4)===ce?Vt.count=Math.max(Vt.count,Ft.start+Ft.count-Vt.start):(++Bt,Dt[Bt]=Ft)}Dt.length=Bt+1;const pt=e.getParameter(s.UNPACK_ROW_LENGTH),vt=e.getParameter(s.UNPACK_SKIP_PIXELS),Ot=e.getParameter(s.UNPACK_SKIP_ROWS);e.pixelStorei(s.UNPACK_ROW_LENGTH,E.width);for(let Yt=0,Vt=Dt.length;Yt<Vt;Yt++){const Ft=Dt[Yt],re=Math.floor(Ft.start/4),ce=Math.ceil(Ft.count/4),ve=re%E.width,Z=Math.floor(re/E.width),Nt=ce,yt=1;e.pixelStorei(s.UNPACK_SKIP_PIXELS,ve),e.pixelStorei(s.UNPACK_SKIP_ROWS,Z),e.texSubImage2D(s.TEXTURE_2D,0,ve,Z,Nt,yt,tt,ot,E.data)}B.clearUpdateRanges(),e.pixelStorei(s.UNPACK_ROW_LENGTH,pt),e.pixelStorei(s.UNPACK_SKIP_PIXELS,vt),e.pixelStorei(s.UNPACK_SKIP_ROWS,Ot)}}function zt(B,E,tt){let ot=s.TEXTURE_2D;(E.isDataArrayTexture||E.isCompressedArrayTexture)&&(ot=s.TEXTURE_2D_ARRAY),E.isData3DTexture&&(ot=s.TEXTURE_3D);const gt=et(B,E),Dt=E.source;e.bindTexture(ot,B.__webglTexture,s.TEXTURE0+tt);const Bt=a.get(Dt);if(Dt.version!==Bt.__version||gt===!0){if(e.activeTexture(s.TEXTURE0+tt),(typeof ImageBitmap<"u"&&E.image instanceof ImageBitmap)===!1){const yt=Ie.getPrimaries(Ie.workingColorSpace),It=E.colorSpace===Ps?null:Ie.getPrimaries(E.colorSpace),qt=E.colorSpace===Ps||yt===It?s.NONE:s.BROWSER_DEFAULT_WEBGL;e.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,E.flipY),e.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),e.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,qt)}e.pixelStorei(s.UNPACK_ALIGNMENT,E.unpackAlignment);let vt=M(E.image,!1,o.maxTextureSize);vt=Me(E,vt);const Ot=l.convert(E.format,E.colorSpace),Yt=l.convert(E.type);let Vt=A(E.internalFormat,Ot,Yt,E.normalized,E.colorSpace,E.isVideoTexture);Lt(ot,E);let Ft;const re=E.mipmaps,ce=E.isVideoTexture!==!0,ve=Bt.__version===void 0||gt===!0,Z=Dt.dataReady,Nt=U(E,vt);if(E.isDepthTexture)Vt=O(E.format===_r,E.type),ve&&(ce?e.texStorage2D(s.TEXTURE_2D,1,Vt,vt.width,vt.height):e.texImage2D(s.TEXTURE_2D,0,Vt,vt.width,vt.height,0,Ot,Yt,null));else if(E.isDataTexture)if(re.length>0){ce&&ve&&e.texStorage2D(s.TEXTURE_2D,Nt,Vt,re[0].width,re[0].height);for(let yt=0,It=re.length;yt<It;yt++)Ft=re[yt],ce?Z&&e.texSubImage2D(s.TEXTURE_2D,yt,0,0,Ft.width,Ft.height,Ot,Yt,Ft.data):e.texImage2D(s.TEXTURE_2D,yt,Vt,Ft.width,Ft.height,0,Ot,Yt,Ft.data);E.generateMipmaps=!1}else ce?(ve&&e.texStorage2D(s.TEXTURE_2D,Nt,Vt,vt.width,vt.height),Z&&Et(E,vt,Ot,Yt)):e.texImage2D(s.TEXTURE_2D,0,Vt,vt.width,vt.height,0,Ot,Yt,vt.data);else if(E.isCompressedTexture)if(E.isCompressedArrayTexture){ce&&ve&&e.texStorage3D(s.TEXTURE_2D_ARRAY,Nt,Vt,re[0].width,re[0].height,vt.depth);for(let yt=0,It=re.length;yt<It;yt++)if(Ft=re[yt],E.format!==ta)if(Ot!==null)if(ce){if(Z)if(E.layerUpdates.size>0){const qt=jx(Ft.width,Ft.height,E.format,E.type);for(const At of E.layerUpdates){const ee=Ft.data.subarray(At*qt/Ft.data.BYTES_PER_ELEMENT,(At+1)*qt/Ft.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,yt,0,0,At,Ft.width,Ft.height,1,Ot,ee)}E.clearLayerUpdates()}else e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,yt,0,0,0,Ft.width,Ft.height,vt.depth,Ot,Ft.data)}else e.compressedTexImage3D(s.TEXTURE_2D_ARRAY,yt,Vt,Ft.width,Ft.height,vt.depth,0,Ft.data,0,0);else ge("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else ce?Z&&e.texSubImage3D(s.TEXTURE_2D_ARRAY,yt,0,0,0,Ft.width,Ft.height,vt.depth,Ot,Yt,Ft.data):e.texImage3D(s.TEXTURE_2D_ARRAY,yt,Vt,Ft.width,Ft.height,vt.depth,0,Ot,Yt,Ft.data)}else{ce&&ve&&e.texStorage2D(s.TEXTURE_2D,Nt,Vt,re[0].width,re[0].height);for(let yt=0,It=re.length;yt<It;yt++)Ft=re[yt],E.format!==ta?Ot!==null?ce?Z&&e.compressedTexSubImage2D(s.TEXTURE_2D,yt,0,0,Ft.width,Ft.height,Ot,Ft.data):e.compressedTexImage2D(s.TEXTURE_2D,yt,Vt,Ft.width,Ft.height,0,Ft.data):ge("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):ce?Z&&e.texSubImage2D(s.TEXTURE_2D,yt,0,0,Ft.width,Ft.height,Ot,Yt,Ft.data):e.texImage2D(s.TEXTURE_2D,yt,Vt,Ft.width,Ft.height,0,Ot,Yt,Ft.data)}else if(E.isDataArrayTexture)if(ce){if(ve&&e.texStorage3D(s.TEXTURE_2D_ARRAY,Nt,Vt,vt.width,vt.height,vt.depth),Z)if(E.layerUpdates.size>0){const yt=jx(vt.width,vt.height,E.format,E.type);for(const It of E.layerUpdates){const qt=vt.data.subarray(It*yt/vt.data.BYTES_PER_ELEMENT,(It+1)*yt/vt.data.BYTES_PER_ELEMENT);e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,It,vt.width,vt.height,1,Ot,Yt,qt)}E.clearLayerUpdates()}else e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,0,vt.width,vt.height,vt.depth,Ot,Yt,vt.data)}else e.texImage3D(s.TEXTURE_2D_ARRAY,0,Vt,vt.width,vt.height,vt.depth,0,Ot,Yt,vt.data);else if(E.isData3DTexture)ce?(ve&&e.texStorage3D(s.TEXTURE_3D,Nt,Vt,vt.width,vt.height,vt.depth),Z&&e.texSubImage3D(s.TEXTURE_3D,0,0,0,0,vt.width,vt.height,vt.depth,Ot,Yt,vt.data)):e.texImage3D(s.TEXTURE_3D,0,Vt,vt.width,vt.height,vt.depth,0,Ot,Yt,vt.data);else if(E.isFramebufferTexture){if(ve)if(ce)e.texStorage2D(s.TEXTURE_2D,Nt,Vt,vt.width,vt.height);else{let yt=vt.width,It=vt.height;for(let qt=0;qt<Nt;qt++)e.texImage2D(s.TEXTURE_2D,qt,Vt,yt,It,0,Ot,Yt,null),yt>>=1,It>>=1}}else if(E.isHTMLTexture){if("texElementImage2D"in s){const yt=s.canvas;if(yt.hasAttribute("layoutsubtree")||yt.setAttribute("layoutsubtree","true"),vt.parentNode!==yt){yt.appendChild(vt),_.add(E),yt.onpaint=It=>{const qt=It.changedElements;for(const At of _)qt.includes(At.image)&&(At.needsUpdate=!0)},yt.requestPaint();return}if(s.texElementImage2D.length===3)s.texElementImage2D(s.TEXTURE_2D,s.RGBA8,vt);else{const qt=s.RGBA,At=s.RGBA,ee=s.UNSIGNED_BYTE;s.texElementImage2D(s.TEXTURE_2D,0,qt,At,ee,vt)}s.texParameteri(s.TEXTURE_2D,s.TEXTURE_MIN_FILTER,s.LINEAR),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_S,s.CLAMP_TO_EDGE),s.texParameteri(s.TEXTURE_2D,s.TEXTURE_WRAP_T,s.CLAMP_TO_EDGE)}}else if(re.length>0){if(ce&&ve){const yt=we(re[0]);e.texStorage2D(s.TEXTURE_2D,Nt,Vt,yt.width,yt.height)}for(let yt=0,It=re.length;yt<It;yt++)Ft=re[yt],ce?Z&&e.texSubImage2D(s.TEXTURE_2D,yt,0,0,Ot,Yt,Ft):e.texImage2D(s.TEXTURE_2D,yt,Vt,Ot,Yt,Ft);E.generateMipmaps=!1}else if(ce){if(ve){const yt=we(vt);e.texStorage2D(s.TEXTURE_2D,Nt,Vt,yt.width,yt.height)}Z&&e.texSubImage2D(s.TEXTURE_2D,0,0,0,Ot,Yt,vt)}else e.texImage2D(s.TEXTURE_2D,0,Vt,Ot,Yt,vt);y(E)&&I(ot),Bt.__version=Dt.version,E.onUpdate&&E.onUpdate(E)}B.__version=E.version}function oe(B,E,tt){if(E.image.length!==6)return;const ot=et(B,E),gt=E.source;e.bindTexture(s.TEXTURE_CUBE_MAP,B.__webglTexture,s.TEXTURE0+tt);const Dt=a.get(gt);if(gt.version!==Dt.__version||ot===!0){e.activeTexture(s.TEXTURE0+tt);const Bt=Ie.getPrimaries(Ie.workingColorSpace),pt=E.colorSpace===Ps?null:Ie.getPrimaries(E.colorSpace),vt=E.colorSpace===Ps||Bt===pt?s.NONE:s.BROWSER_DEFAULT_WEBGL;e.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,E.flipY),e.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,E.premultiplyAlpha),e.pixelStorei(s.UNPACK_ALIGNMENT,E.unpackAlignment),e.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,vt);const Ot=E.isCompressedTexture||E.image[0].isCompressedTexture,Yt=E.image[0]&&E.image[0].isDataTexture,Vt=[];for(let At=0;At<6;At++)!Ot&&!Yt?Vt[At]=M(E.image[At],!0,o.maxCubemapSize):Vt[At]=Yt?E.image[At].image:E.image[At],Vt[At]=Me(E,Vt[At]);const Ft=Vt[0],re=l.convert(E.format,E.colorSpace),ce=l.convert(E.type),ve=A(E.internalFormat,re,ce,E.normalized,E.colorSpace),Z=E.isVideoTexture!==!0,Nt=Dt.__version===void 0||ot===!0,yt=gt.dataReady;let It=U(E,Ft);Lt(s.TEXTURE_CUBE_MAP,E);let qt;if(Ot){Z&&Nt&&e.texStorage2D(s.TEXTURE_CUBE_MAP,It,ve,Ft.width,Ft.height);for(let At=0;At<6;At++){qt=Vt[At].mipmaps;for(let ee=0;ee<qt.length;ee++){const Qt=qt[ee];E.format!==ta?re!==null?Z?yt&&e.compressedTexSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,ee,0,0,Qt.width,Qt.height,re,Qt.data):e.compressedTexImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,ee,ve,Qt.width,Qt.height,0,Qt.data):ge("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Z?yt&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,ee,0,0,Qt.width,Qt.height,re,ce,Qt.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,ee,ve,Qt.width,Qt.height,0,re,ce,Qt.data)}}}else{if(qt=E.mipmaps,Z&&Nt){qt.length>0&&It++;const At=we(Vt[0]);e.texStorage2D(s.TEXTURE_CUBE_MAP,It,ve,At.width,At.height)}for(let At=0;At<6;At++)if(Yt){Z?yt&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,0,0,0,Vt[At].width,Vt[At].height,re,ce,Vt[At].data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,0,ve,Vt[At].width,Vt[At].height,0,re,ce,Vt[At].data);for(let ee=0;ee<qt.length;ee++){const cn=qt[ee].image[At].image;Z?yt&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,ee+1,0,0,cn.width,cn.height,re,ce,cn.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,ee+1,ve,cn.width,cn.height,0,re,ce,cn.data)}}else{Z?yt&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,0,0,0,re,ce,Vt[At]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,0,ve,re,ce,Vt[At]);for(let ee=0;ee<qt.length;ee++){const Qt=qt[ee];Z?yt&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,ee+1,0,0,re,ce,Qt.image[At]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+At,ee+1,ve,re,ce,Qt.image[At])}}}y(E)&&I(s.TEXTURE_CUBE_MAP),Dt.__version=gt.version,E.onUpdate&&E.onUpdate(E)}B.__version=E.version}function ae(B,E,tt,ot,gt,Dt){const Bt=l.convert(tt.format,tt.colorSpace),pt=l.convert(tt.type),vt=A(tt.internalFormat,Bt,pt,tt.normalized,tt.colorSpace),Ot=a.get(E),Yt=a.get(tt);if(Yt.__renderTarget=E,!Ot.__hasExternalTextures){const Vt=Math.max(1,E.width>>Dt),Ft=Math.max(1,E.height>>Dt);gt===s.TEXTURE_3D||gt===s.TEXTURE_2D_ARRAY?e.texImage3D(gt,Dt,vt,Vt,Ft,E.depth,0,Bt,pt,null):e.texImage2D(gt,Dt,vt,Vt,Ft,0,Bt,pt,null)}e.bindFramebuffer(s.FRAMEBUFFER,B),xe(E)?h.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,ot,gt,Yt.__webglTexture,0,he(E)):(gt===s.TEXTURE_2D||gt>=s.TEXTURE_CUBE_MAP_POSITIVE_X&&gt<=s.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&s.framebufferTexture2D(s.FRAMEBUFFER,ot,gt,Yt.__webglTexture,Dt),e.bindFramebuffer(s.FRAMEBUFFER,null)}function Pe(B,E,tt){if(s.bindRenderbuffer(s.RENDERBUFFER,B),E.depthBuffer){const ot=E.depthTexture,gt=ot&&ot.isDepthTexture?ot.type:null,Dt=O(E.stencilBuffer,gt),Bt=E.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;xe(E)?h.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,he(E),Dt,E.width,E.height):tt?s.renderbufferStorageMultisample(s.RENDERBUFFER,he(E),Dt,E.width,E.height):s.renderbufferStorage(s.RENDERBUFFER,Dt,E.width,E.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,Bt,s.RENDERBUFFER,B)}else{const ot=E.textures;for(let gt=0;gt<ot.length;gt++){const Dt=ot[gt],Bt=l.convert(Dt.format,Dt.colorSpace),pt=l.convert(Dt.type),vt=A(Dt.internalFormat,Bt,pt,Dt.normalized,Dt.colorSpace);xe(E)?h.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,he(E),vt,E.width,E.height):tt?s.renderbufferStorageMultisample(s.RENDERBUFFER,he(E),vt,E.width,E.height):s.renderbufferStorage(s.RENDERBUFFER,vt,E.width,E.height)}}s.bindRenderbuffer(s.RENDERBUFFER,null)}function me(B,E,tt){const ot=E.isWebGLCubeRenderTarget===!0;if(e.bindFramebuffer(s.FRAMEBUFFER,B),!(E.depthTexture&&E.depthTexture.isDepthTexture))throw new Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");const gt=a.get(E.depthTexture);if(gt.__renderTarget=E,(!gt.__webglTexture||E.depthTexture.image.width!==E.width||E.depthTexture.image.height!==E.height)&&(E.depthTexture.image.width=E.width,E.depthTexture.image.height=E.height,E.depthTexture.needsUpdate=!0),ot){if(gt.__webglInit===void 0&&(gt.__webglInit=!0,E.depthTexture.addEventListener("dispose",z)),gt.__webglTexture===void 0){gt.__webglTexture=s.createTexture(),e.bindTexture(s.TEXTURE_CUBE_MAP,gt.__webglTexture),Lt(s.TEXTURE_CUBE_MAP,E.depthTexture);const Ot=l.convert(E.depthTexture.format),Yt=l.convert(E.depthTexture.type);let Vt;E.depthTexture.format===ja?Vt=s.DEPTH_COMPONENT24:E.depthTexture.format===_r&&(Vt=s.DEPTH24_STENCIL8);for(let Ft=0;Ft<6;Ft++)s.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+Ft,0,Vt,E.width,E.height,0,Ot,Yt,null)}}else V(E.depthTexture,0);const Dt=gt.__webglTexture,Bt=he(E),pt=ot?s.TEXTURE_CUBE_MAP_POSITIVE_X+tt:s.TEXTURE_2D,vt=E.depthTexture.format===_r?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;if(E.depthTexture.format===ja)xe(E)?h.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,vt,pt,Dt,0,Bt):s.framebufferTexture2D(s.FRAMEBUFFER,vt,pt,Dt,0);else if(E.depthTexture.format===_r)xe(E)?h.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,vt,pt,Dt,0,Bt):s.framebufferTexture2D(s.FRAMEBUFFER,vt,pt,Dt,0);else throw new Error("THREE.WebGLTextures: Unknown depthTexture format.")}function Tt(B){const E=a.get(B),tt=B.isWebGLCubeRenderTarget===!0;if(E.__boundDepthTexture!==B.depthTexture){const ot=B.depthTexture;if(E.__depthDisposeCallback&&E.__depthDisposeCallback(),ot){const gt=()=>{delete E.__boundDepthTexture,delete E.__depthDisposeCallback,ot.removeEventListener("dispose",gt)};ot.addEventListener("dispose",gt),E.__depthDisposeCallback=gt}E.__boundDepthTexture=ot}if(B.depthTexture&&!E.__autoAllocateDepthBuffer)if(tt)for(let ot=0;ot<6;ot++)me(E.__webglFramebuffer[ot],B,ot);else{const ot=B.texture.mipmaps;ot&&ot.length>0?me(E.__webglFramebuffer[0],B,0):me(E.__webglFramebuffer,B,0)}else if(tt){E.__webglDepthbuffer=[];for(let ot=0;ot<6;ot++)if(e.bindFramebuffer(s.FRAMEBUFFER,E.__webglFramebuffer[ot]),E.__webglDepthbuffer[ot]===void 0)E.__webglDepthbuffer[ot]=s.createRenderbuffer(),Pe(E.__webglDepthbuffer[ot],B,!1);else{const gt=B.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Dt=E.__webglDepthbuffer[ot];s.bindRenderbuffer(s.RENDERBUFFER,Dt),s.framebufferRenderbuffer(s.FRAMEBUFFER,gt,s.RENDERBUFFER,Dt)}}else{const ot=B.texture.mipmaps;if(ot&&ot.length>0?e.bindFramebuffer(s.FRAMEBUFFER,E.__webglFramebuffer[0]):e.bindFramebuffer(s.FRAMEBUFFER,E.__webglFramebuffer),E.__webglDepthbuffer===void 0)E.__webglDepthbuffer=s.createRenderbuffer(),Pe(E.__webglDepthbuffer,B,!1);else{const gt=B.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Dt=E.__webglDepthbuffer;s.bindRenderbuffer(s.RENDERBUFFER,Dt),s.framebufferRenderbuffer(s.FRAMEBUFFER,gt,s.RENDERBUFFER,Dt)}}e.bindFramebuffer(s.FRAMEBUFFER,null)}function Rt(B,E,tt){const ot=a.get(B);E!==void 0&&ae(ot.__webglFramebuffer,B,B.texture,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,0),tt!==void 0&&Tt(B)}function wt(B){const E=B.texture,tt=a.get(B),ot=a.get(E);B.addEventListener("dispose",T);const gt=B.textures,Dt=B.isWebGLCubeRenderTarget===!0,Bt=gt.length>1;if(Bt||(ot.__webglTexture===void 0&&(ot.__webglTexture=s.createTexture()),ot.__version=E.version,u.memory.textures++),Dt){tt.__webglFramebuffer=[];for(let pt=0;pt<6;pt++)if(E.mipmaps&&E.mipmaps.length>0){tt.__webglFramebuffer[pt]=[];for(let vt=0;vt<E.mipmaps.length;vt++)tt.__webglFramebuffer[pt][vt]=s.createFramebuffer()}else tt.__webglFramebuffer[pt]=s.createFramebuffer()}else{if(E.mipmaps&&E.mipmaps.length>0){tt.__webglFramebuffer=[];for(let pt=0;pt<E.mipmaps.length;pt++)tt.__webglFramebuffer[pt]=s.createFramebuffer()}else tt.__webglFramebuffer=s.createFramebuffer();if(Bt)for(let pt=0,vt=gt.length;pt<vt;pt++){const Ot=a.get(gt[pt]);Ot.__webglTexture===void 0&&(Ot.__webglTexture=s.createTexture(),u.memory.textures++)}if(B.samples>0&&xe(B)===!1){tt.__webglMultisampledFramebuffer=s.createFramebuffer(),tt.__webglColorRenderbuffer=[],e.bindFramebuffer(s.FRAMEBUFFER,tt.__webglMultisampledFramebuffer);for(let pt=0;pt<gt.length;pt++){const vt=gt[pt];tt.__webglColorRenderbuffer[pt]=s.createRenderbuffer(),s.bindRenderbuffer(s.RENDERBUFFER,tt.__webglColorRenderbuffer[pt]);const Ot=l.convert(vt.format,vt.colorSpace),Yt=l.convert(vt.type),Vt=A(vt.internalFormat,Ot,Yt,vt.normalized,vt.colorSpace,B.isXRRenderTarget===!0),Ft=he(B);s.renderbufferStorageMultisample(s.RENDERBUFFER,Ft,Vt,B.width,B.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+pt,s.RENDERBUFFER,tt.__webglColorRenderbuffer[pt])}s.bindRenderbuffer(s.RENDERBUFFER,null),B.depthBuffer&&(tt.__webglDepthRenderbuffer=s.createRenderbuffer(),Pe(tt.__webglDepthRenderbuffer,B,!0)),e.bindFramebuffer(s.FRAMEBUFFER,null)}}if(Dt){e.bindTexture(s.TEXTURE_CUBE_MAP,ot.__webglTexture),Lt(s.TEXTURE_CUBE_MAP,E);for(let pt=0;pt<6;pt++)if(E.mipmaps&&E.mipmaps.length>0)for(let vt=0;vt<E.mipmaps.length;vt++)ae(tt.__webglFramebuffer[pt][vt],B,E,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+pt,vt);else ae(tt.__webglFramebuffer[pt],B,E,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+pt,0);y(E)&&I(s.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(Bt){for(let pt=0,vt=gt.length;pt<vt;pt++){const Ot=gt[pt],Yt=a.get(Ot);let Vt=s.TEXTURE_2D;(B.isWebGL3DRenderTarget||B.isWebGLArrayRenderTarget)&&(Vt=B.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),e.bindTexture(Vt,Yt.__webglTexture),Lt(Vt,Ot),ae(tt.__webglFramebuffer,B,Ot,s.COLOR_ATTACHMENT0+pt,Vt,0),y(Ot)&&I(Vt)}e.unbindTexture()}else{let pt=s.TEXTURE_2D;if((B.isWebGL3DRenderTarget||B.isWebGLArrayRenderTarget)&&(pt=B.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),e.bindTexture(pt,ot.__webglTexture),Lt(pt,E),E.mipmaps&&E.mipmaps.length>0)for(let vt=0;vt<E.mipmaps.length;vt++)ae(tt.__webglFramebuffer[vt],B,E,s.COLOR_ATTACHMENT0,pt,vt);else ae(tt.__webglFramebuffer,B,E,s.COLOR_ATTACHMENT0,pt,0);y(E)&&I(pt),e.unbindTexture()}B.depthBuffer&&Tt(B)}function kt(B){const E=B.textures;for(let tt=0,ot=E.length;tt<ot;tt++){const gt=E[tt];if(y(gt)){const Dt=D(B),Bt=a.get(gt).__webglTexture;e.bindTexture(Dt,Bt),I(Dt),e.unbindTexture()}}}const Gt=[],le=[];function ne(B){if(B.samples>0){if(xe(B)===!1){const E=B.textures,tt=B.width,ot=B.height;let gt=s.COLOR_BUFFER_BIT;const Dt=B.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Bt=a.get(B),pt=E.length>1;if(pt)for(let Ot=0;Ot<E.length;Ot++)e.bindFramebuffer(s.FRAMEBUFFER,Bt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Ot,s.RENDERBUFFER,null),e.bindFramebuffer(s.FRAMEBUFFER,Bt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+Ot,s.TEXTURE_2D,null,0);e.bindFramebuffer(s.READ_FRAMEBUFFER,Bt.__webglMultisampledFramebuffer);const vt=B.texture.mipmaps;vt&&vt.length>0?e.bindFramebuffer(s.DRAW_FRAMEBUFFER,Bt.__webglFramebuffer[0]):e.bindFramebuffer(s.DRAW_FRAMEBUFFER,Bt.__webglFramebuffer);for(let Ot=0;Ot<E.length;Ot++){if(B.resolveDepthBuffer&&(B.depthBuffer&&(gt|=s.DEPTH_BUFFER_BIT),B.stencilBuffer&&B.resolveStencilBuffer&&(gt|=s.STENCIL_BUFFER_BIT)),pt){s.framebufferRenderbuffer(s.READ_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.RENDERBUFFER,Bt.__webglColorRenderbuffer[Ot]);const Yt=a.get(E[Ot]).__webglTexture;s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,Yt,0)}s.blitFramebuffer(0,0,tt,ot,0,0,tt,ot,gt,s.NEAREST),d===!0&&(Gt.length=0,le.length=0,Gt.push(s.COLOR_ATTACHMENT0+Ot),B.depthBuffer&&B.resolveDepthBuffer===!1&&(Gt.push(Dt),le.push(Dt),s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,le)),s.invalidateFramebuffer(s.READ_FRAMEBUFFER,Gt))}if(e.bindFramebuffer(s.READ_FRAMEBUFFER,null),e.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),pt)for(let Ot=0;Ot<E.length;Ot++){e.bindFramebuffer(s.FRAMEBUFFER,Bt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Ot,s.RENDERBUFFER,Bt.__webglColorRenderbuffer[Ot]);const Yt=a.get(E[Ot]).__webglTexture;e.bindFramebuffer(s.FRAMEBUFFER,Bt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+Ot,s.TEXTURE_2D,Yt,0)}e.bindFramebuffer(s.DRAW_FRAMEBUFFER,Bt.__webglMultisampledFramebuffer)}else if(B.depthBuffer&&B.resolveDepthBuffer===!1&&d){const E=B.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,[E])}}}function he(B){return Math.min(o.maxSamples,B.samples)}function xe(B){const E=a.get(B);return B.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&E.__useRenderToTexture!==!1}function W(B){const E=u.render.frame;g.get(B)!==E&&(g.set(B,E),B.update())}function Me(B,E){const tt=B.colorSpace,ot=B.format,gt=B.type;return B.isCompressedTexture===!0||B.isVideoTexture===!0||tt!==df&&tt!==Ps&&(Ie.getTransfer(tt)===Je?(ot!==ta||gt!==Di)&&ge("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):Oe("WebGLTextures: Unsupported texture color space:",tt)),E}function we(B){return typeof HTMLImageElement<"u"&&B instanceof HTMLImageElement?(p.width=B.naturalWidth||B.width,p.height=B.naturalHeight||B.height):typeof VideoFrame<"u"&&B instanceof VideoFrame?(p.width=B.displayWidth,p.height=B.displayHeight):(p.width=B.width,p.height=B.height),p}this.allocateTextureUnit=F,this.resetTextureUnits=ft,this.getTextureUnits=dt,this.setTextureUnits=J,this.setTexture2D=V,this.setTexture2DArray=nt,this.setTexture3D=mt,this.setTextureCube=L,this.rebindTextures=Rt,this.setupRenderTarget=wt,this.updateRenderTargetMipmap=kt,this.updateMultisampleRenderTarget=ne,this.setupDepthRenderbuffer=Tt,this.setupFrameBufferTexture=ae,this.useMultisampledRTT=xe,this.isReversedDepthBuffer=function(){return e.buffers.depth.getReversed()}}function j3(s,t){function e(a,o=Ps){let l;const u=Ie.getTransfer(o);if(a===Di)return s.UNSIGNED_BYTE;if(a===zm)return s.UNSIGNED_SHORT_4_4_4_4;if(a===Fm)return s.UNSIGNED_SHORT_5_5_5_1;if(a===Gy)return s.UNSIGNED_INT_5_9_9_9_REV;if(a===Vy)return s.UNSIGNED_INT_10F_11F_11F_REV;if(a===Fy)return s.BYTE;if(a===Hy)return s.SHORT;if(a===rc)return s.UNSIGNED_SHORT;if(a===Im)return s.INT;if(a===ga)return s.UNSIGNED_INT;if(a===ji)return s.FLOAT;if(a===$a)return s.HALF_FLOAT;if(a===ky)return s.ALPHA;if(a===Xy)return s.RGB;if(a===ta)return s.RGBA;if(a===ja)return s.DEPTH_COMPONENT;if(a===_r)return s.DEPTH_STENCIL;if(a===Hm)return s.RED;if(a===Gm)return s.RED_INTEGER;if(a===Sr)return s.RG;if(a===Vm)return s.RG_INTEGER;if(a===km)return s.RGBA_INTEGER;if(a===ef||a===nf||a===af||a===sf)if(u===Je)if(l=t.get("WEBGL_compressed_texture_s3tc_srgb"),l!==null){if(a===ef)return l.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(a===nf)return l.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(a===af)return l.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(a===sf)return l.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(l=t.get("WEBGL_compressed_texture_s3tc"),l!==null){if(a===ef)return l.COMPRESSED_RGB_S3TC_DXT1_EXT;if(a===nf)return l.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(a===af)return l.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(a===sf)return l.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(a===Ip||a===zp||a===Fp||a===Hp)if(l=t.get("WEBGL_compressed_texture_pvrtc"),l!==null){if(a===Ip)return l.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(a===zp)return l.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(a===Fp)return l.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(a===Hp)return l.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(a===Gp||a===Vp||a===kp||a===Xp||a===Wp||a===uf||a===qp)if(l=t.get("WEBGL_compressed_texture_etc"),l!==null){if(a===Gp||a===Vp)return u===Je?l.COMPRESSED_SRGB8_ETC2:l.COMPRESSED_RGB8_ETC2;if(a===kp)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:l.COMPRESSED_RGBA8_ETC2_EAC;if(a===Xp)return l.COMPRESSED_R11_EAC;if(a===Wp)return l.COMPRESSED_SIGNED_R11_EAC;if(a===uf)return l.COMPRESSED_RG11_EAC;if(a===qp)return l.COMPRESSED_SIGNED_RG11_EAC}else return null;if(a===Yp||a===Zp||a===Kp||a===Jp||a===Qp||a===$p||a===jp||a===tm||a===em||a===nm||a===im||a===am||a===sm||a===rm)if(l=t.get("WEBGL_compressed_texture_astc"),l!==null){if(a===Yp)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:l.COMPRESSED_RGBA_ASTC_4x4_KHR;if(a===Zp)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:l.COMPRESSED_RGBA_ASTC_5x4_KHR;if(a===Kp)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:l.COMPRESSED_RGBA_ASTC_5x5_KHR;if(a===Jp)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:l.COMPRESSED_RGBA_ASTC_6x5_KHR;if(a===Qp)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:l.COMPRESSED_RGBA_ASTC_6x6_KHR;if(a===$p)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:l.COMPRESSED_RGBA_ASTC_8x5_KHR;if(a===jp)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:l.COMPRESSED_RGBA_ASTC_8x6_KHR;if(a===tm)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:l.COMPRESSED_RGBA_ASTC_8x8_KHR;if(a===em)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:l.COMPRESSED_RGBA_ASTC_10x5_KHR;if(a===nm)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:l.COMPRESSED_RGBA_ASTC_10x6_KHR;if(a===im)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:l.COMPRESSED_RGBA_ASTC_10x8_KHR;if(a===am)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:l.COMPRESSED_RGBA_ASTC_10x10_KHR;if(a===sm)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:l.COMPRESSED_RGBA_ASTC_12x10_KHR;if(a===rm)return u===Je?l.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:l.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(a===om||a===lm||a===cm)if(l=t.get("EXT_texture_compression_bptc"),l!==null){if(a===om)return u===Je?l.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:l.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(a===lm)return l.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(a===cm)return l.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(a===um||a===fm||a===ff||a===hm)if(l=t.get("EXT_texture_compression_rgtc"),l!==null){if(a===um)return l.COMPRESSED_RED_RGTC1_EXT;if(a===fm)return l.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(a===ff)return l.COMPRESSED_RED_GREEN_RGTC2_EXT;if(a===hm)return l.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return a===oc?s.UNSIGNED_INT_24_8:s[a]!==void 0?s[a]:null}return{convert:e}}const tR=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,eR=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class nR{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e){if(this.texture===null){const a=new nS(t.texture);(t.depthNear!==e.depthNear||t.depthFar!==e.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=a}}getMesh(t){if(this.texture!==null&&this.mesh===null){const e=t.cameras[0].viewport,a=new Ui({vertexShader:tR,fragmentShader:eR,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new Ge(new Vo(20,20),a)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class iR extends Er{constructor(t,e){super();const a=this;let o=null,l=1,u=null,h="local-floor",d=1,p=null,g=null,_=null,v=null,x=null,b=null;const C=typeof XRWebGLBinding<"u",M=new nR,y={},I=e.getContextAttributes();let D=null,A=null;const O=[],U=[],z=new Ut;let T=null;const P=new Ci;P.viewport=new pn;const k=new Ci;k.viewport=new pn;const H=[P,k],K=new hT;let ft=null,dt=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(et){let Mt=O[et];return Mt===void 0&&(Mt=new Yd,O[et]=Mt),Mt.getTargetRaySpace()},this.getControllerGrip=function(et){let Mt=O[et];return Mt===void 0&&(Mt=new Yd,O[et]=Mt),Mt.getGripSpace()},this.getHand=function(et){let Mt=O[et];return Mt===void 0&&(Mt=new Yd,O[et]=Mt),Mt.getHandSpace()};function J(et){const Mt=U.indexOf(et.inputSource);if(Mt===-1)return;const Et=O[Mt];Et!==void 0&&(Et.update(et.inputSource,et.frame,p||u),Et.dispatchEvent({type:et.type,data:et.inputSource}))}function F(){o.removeEventListener("select",J),o.removeEventListener("selectstart",J),o.removeEventListener("selectend",J),o.removeEventListener("squeeze",J),o.removeEventListener("squeezestart",J),o.removeEventListener("squeezeend",J),o.removeEventListener("end",F),o.removeEventListener("inputsourceschange",N);for(let et=0;et<O.length;et++){const Mt=U[et];Mt!==null&&(U[et]=null,O[et].disconnect(Mt))}ft=null,dt=null,M.reset();for(const et in y)delete y[et];t.setRenderTarget(D),x=null,v=null,_=null,o=null,A=null,Lt.stop(),a.isPresenting=!1,t.setPixelRatio(T),t.setSize(z.width,z.height,!1),a.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(et){l=et,a.isPresenting===!0&&ge("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(et){h=et,a.isPresenting===!0&&ge("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return p||u},this.setReferenceSpace=function(et){p=et},this.getBaseLayer=function(){return v!==null?v:x},this.getBinding=function(){return _===null&&C&&(_=new XRWebGLBinding(o,e)),_},this.getFrame=function(){return b},this.getSession=function(){return o},this.setSession=async function(et){if(o=et,o!==null){if(D=t.getRenderTarget(),o.addEventListener("select",J),o.addEventListener("selectstart",J),o.addEventListener("selectend",J),o.addEventListener("squeeze",J),o.addEventListener("squeezestart",J),o.addEventListener("squeezeend",J),o.addEventListener("end",F),o.addEventListener("inputsourceschange",N),I.xrCompatible!==!0&&await e.makeXRCompatible(),T=t.getPixelRatio(),t.getSize(z),C&&"createProjectionLayer"in XRWebGLBinding.prototype){let Et=null,zt=null,oe=null;I.depth&&(oe=I.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,Et=I.stencil?_r:ja,zt=I.stencil?oc:ga);const ae={colorFormat:e.RGBA8,depthFormat:oe,scaleFactor:l};_=this.getBinding(),v=_.createProjectionLayer(ae),o.updateRenderState({layers:[v]}),t.setPixelRatio(1),t.setSize(v.textureWidth,v.textureHeight,!1),A=new ma(v.textureWidth,v.textureHeight,{format:ta,type:Di,depthTexture:new Ho(v.textureWidth,v.textureHeight,zt,void 0,void 0,void 0,void 0,void 0,void 0,Et),stencilBuffer:I.stencil,colorSpace:t.outputColorSpace,samples:I.antialias?4:0,resolveDepthBuffer:v.ignoreDepthValues===!1,resolveStencilBuffer:v.ignoreDepthValues===!1})}else{const Et={antialias:I.antialias,alpha:!0,depth:I.depth,stencil:I.stencil,framebufferScaleFactor:l};x=new XRWebGLLayer(o,e,Et),o.updateRenderState({baseLayer:x}),t.setPixelRatio(1),t.setSize(x.framebufferWidth,x.framebufferHeight,!1),A=new ma(x.framebufferWidth,x.framebufferHeight,{format:ta,type:Di,colorSpace:t.outputColorSpace,stencilBuffer:I.stencil,resolveDepthBuffer:x.ignoreDepthValues===!1,resolveStencilBuffer:x.ignoreDepthValues===!1})}A.isXRRenderTarget=!0,this.setFoveation(d),p=null,u=await o.requestReferenceSpace(h),Lt.setContext(o),Lt.start(),a.isPresenting=!0,a.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(o!==null)return o.environmentBlendMode},this.getDepthTexture=function(){return M.getDepthTexture()};function N(et){for(let Mt=0;Mt<et.removed.length;Mt++){const Et=et.removed[Mt],zt=U.indexOf(Et);zt>=0&&(U[zt]=null,O[zt].disconnect(Et))}for(let Mt=0;Mt<et.added.length;Mt++){const Et=et.added[Mt];let zt=U.indexOf(Et);if(zt===-1){for(let ae=0;ae<O.length;ae++)if(ae>=U.length){U.push(Et),zt=ae;break}else if(U[ae]===null){U[ae]=Et,zt=ae;break}if(zt===-1)break}const oe=O[zt];oe&&oe.connect(Et)}}const V=new q,nt=new q;function mt(et,Mt,Et){V.setFromMatrixPosition(Mt.matrixWorld),nt.setFromMatrixPosition(Et.matrixWorld);const zt=V.distanceTo(nt),oe=Mt.projectionMatrix.elements,ae=Et.projectionMatrix.elements,Pe=oe[14]/(oe[10]-1),me=oe[14]/(oe[10]+1),Tt=(oe[9]+1)/oe[5],Rt=(oe[9]-1)/oe[5],wt=(oe[8]-1)/oe[0],kt=(ae[8]+1)/ae[0],Gt=Pe*wt,le=Pe*kt,ne=zt/(-wt+kt),he=ne*-wt;if(Mt.matrixWorld.decompose(et.position,et.quaternion,et.scale),et.translateX(he),et.translateZ(ne),et.matrixWorld.compose(et.position,et.quaternion,et.scale),et.matrixWorldInverse.copy(et.matrixWorld).invert(),oe[10]===-1)et.projectionMatrix.copy(Mt.projectionMatrix),et.projectionMatrixInverse.copy(Mt.projectionMatrixInverse);else{const xe=Pe+ne,W=me+ne,Me=Gt-he,we=le+(zt-he),B=Tt*me/W*xe,E=Rt*me/W*xe;et.projectionMatrix.makePerspective(Me,we,B,E,xe,W),et.projectionMatrixInverse.copy(et.projectionMatrix).invert()}}function L(et,Mt){Mt===null?et.matrixWorld.copy(et.matrix):et.matrixWorld.multiplyMatrices(Mt.matrixWorld,et.matrix),et.matrixWorldInverse.copy(et.matrixWorld).invert()}this.updateCamera=function(et){if(o===null)return;let Mt=et.near,Et=et.far;M.texture!==null&&(M.depthNear>0&&(Mt=M.depthNear),M.depthFar>0&&(Et=M.depthFar)),K.near=k.near=P.near=Mt,K.far=k.far=P.far=Et,(ft!==K.near||dt!==K.far)&&(o.updateRenderState({depthNear:K.near,depthFar:K.far}),ft=K.near,dt=K.far),K.layers.mask=et.layers.mask|6,P.layers.mask=K.layers.mask&-5,k.layers.mask=K.layers.mask&-3;const zt=et.parent,oe=K.cameras;L(K,zt);for(let ae=0;ae<oe.length;ae++)L(oe[ae],zt);oe.length===2?mt(K,P,k):K.projectionMatrix.copy(P.projectionMatrix),X(et,K,zt)};function X(et,Mt,Et){Et===null?et.matrix.copy(Mt.matrixWorld):(et.matrix.copy(Et.matrixWorld),et.matrix.invert(),et.matrix.multiply(Mt.matrixWorld)),et.matrix.decompose(et.position,et.quaternion,et.scale),et.updateMatrixWorld(!0),et.projectionMatrix.copy(Mt.projectionMatrix),et.projectionMatrixInverse.copy(Mt.projectionMatrixInverse),et.isPerspectiveCamera&&(et.fov=pm*2*Math.atan(1/et.projectionMatrix.elements[5]),et.zoom=1)}this.getCamera=function(){return K},this.getFoveation=function(){if(!(v===null&&x===null))return d},this.setFoveation=function(et){d=et,v!==null&&(v.fixedFoveation=et),x!==null&&x.fixedFoveation!==void 0&&(x.fixedFoveation=et)},this.hasDepthSensing=function(){return M.texture!==null},this.getDepthSensingMesh=function(){return M.getMesh(K)},this.getCameraTexture=function(et){return y[et]};let _t=null;function Ct(et,Mt){if(g=Mt.getViewerPose(p||u),b=Mt,g!==null){const Et=g.views;x!==null&&(t.setRenderTargetFramebuffer(A,x.framebuffer),t.setRenderTarget(A));let zt=!1;Et.length!==K.cameras.length&&(K.cameras.length=0,zt=!0);for(let me=0;me<Et.length;me++){const Tt=Et[me];let Rt=null;if(x!==null)Rt=x.getViewport(Tt);else{const kt=_.getViewSubImage(v,Tt);Rt=kt.viewport,me===0&&(t.setRenderTargetTextures(A,kt.colorTexture,kt.depthStencilTexture),t.setRenderTarget(A))}let wt=H[me];wt===void 0&&(wt=new Ci,wt.layers.enable(me),wt.viewport=new pn,H[me]=wt),wt.matrix.fromArray(Tt.transform.matrix),wt.matrix.decompose(wt.position,wt.quaternion,wt.scale),wt.projectionMatrix.fromArray(Tt.projectionMatrix),wt.projectionMatrixInverse.copy(wt.projectionMatrix).invert(),wt.viewport.set(Rt.x,Rt.y,Rt.width,Rt.height),me===0&&(K.matrix.copy(wt.matrix),K.matrix.decompose(K.position,K.quaternion,K.scale)),zt===!0&&K.cameras.push(wt)}const oe=o.enabledFeatures;if(oe&&oe.includes("depth-sensing")&&o.depthUsage=="gpu-optimized"&&C){_=a.getBinding();const me=_.getDepthInformation(Et[0]);me&&me.isValid&&me.texture&&M.init(me,o.renderState)}if(oe&&oe.includes("camera-access")&&C){t.state.unbindTexture(),_=a.getBinding();for(let me=0;me<Et.length;me++){const Tt=Et[me].camera;if(Tt){let Rt=y[Tt];Rt||(Rt=new nS,y[Tt]=Rt);const wt=_.getCameraImage(Tt);Rt.sourceTexture=wt}}}}for(let Et=0;Et<O.length;Et++){const zt=U[Et],oe=O[Et];zt!==null&&oe!==void 0&&oe.update(zt,Mt,p||u)}_t&&_t(et,Mt),Mt.detectedPlanes&&a.dispatchEvent({type:"planesdetected",data:Mt}),b=null}const Lt=new vS;Lt.setAnimationLoop(Ct),this.setAnimationLoop=function(et){_t=et},this.dispose=function(){}}}const aR=new en,ES=new Se;ES.set(-1,0,0,0,1,0,0,0,1);function sR(s,t){function e(M,y){M.matrixAutoUpdate===!0&&M.updateMatrix(),y.value.copy(M.matrix)}function a(M,y){y.color.getRGB(M.fogColor.value,pS(s)),y.isFog?(M.fogNear.value=y.near,M.fogFar.value=y.far):y.isFogExp2&&(M.fogDensity.value=y.density)}function o(M,y,I,D,A){y.isNodeMaterial?y.uniformsNeedUpdate=!1:y.isMeshBasicMaterial?l(M,y):y.isMeshLambertMaterial?(l(M,y),y.envMap&&(M.envMapIntensity.value=y.envMapIntensity)):y.isMeshToonMaterial?(l(M,y),_(M,y)):y.isMeshPhongMaterial?(l(M,y),g(M,y),y.envMap&&(M.envMapIntensity.value=y.envMapIntensity)):y.isMeshStandardMaterial?(l(M,y),v(M,y),y.isMeshPhysicalMaterial&&x(M,y,A)):y.isMeshMatcapMaterial?(l(M,y),b(M,y)):y.isMeshDepthMaterial?l(M,y):y.isMeshDistanceMaterial?(l(M,y),C(M,y)):y.isMeshNormalMaterial?l(M,y):y.isLineBasicMaterial?(u(M,y),y.isLineDashedMaterial&&h(M,y)):y.isPointsMaterial?d(M,y,I,D):y.isSpriteMaterial?p(M,y):y.isShadowMaterial?(M.color.value.copy(y.color),M.opacity.value=y.opacity):y.isShaderMaterial&&(y.uniformsNeedUpdate=!1)}function l(M,y){M.opacity.value=y.opacity,y.color&&M.diffuse.value.copy(y.color),y.emissive&&M.emissive.value.copy(y.emissive).multiplyScalar(y.emissiveIntensity),y.map&&(M.map.value=y.map,e(y.map,M.mapTransform)),y.alphaMap&&(M.alphaMap.value=y.alphaMap,e(y.alphaMap,M.alphaMapTransform)),y.bumpMap&&(M.bumpMap.value=y.bumpMap,e(y.bumpMap,M.bumpMapTransform),M.bumpScale.value=y.bumpScale,y.side===ni&&(M.bumpScale.value*=-1)),y.normalMap&&(M.normalMap.value=y.normalMap,e(y.normalMap,M.normalMapTransform),M.normalScale.value.copy(y.normalScale),y.side===ni&&M.normalScale.value.negate()),y.displacementMap&&(M.displacementMap.value=y.displacementMap,e(y.displacementMap,M.displacementMapTransform),M.displacementScale.value=y.displacementScale,M.displacementBias.value=y.displacementBias),y.emissiveMap&&(M.emissiveMap.value=y.emissiveMap,e(y.emissiveMap,M.emissiveMapTransform)),y.specularMap&&(M.specularMap.value=y.specularMap,e(y.specularMap,M.specularMapTransform)),y.alphaTest>0&&(M.alphaTest.value=y.alphaTest);const I=t.get(y),D=I.envMap,A=I.envMapRotation;D&&(M.envMap.value=D,M.envMapRotation.value.setFromMatrix4(aR.makeRotationFromEuler(A)).transpose(),D.isCubeTexture&&D.isRenderTargetTexture===!1&&M.envMapRotation.value.premultiply(ES),M.reflectivity.value=y.reflectivity,M.ior.value=y.ior,M.refractionRatio.value=y.refractionRatio),y.lightMap&&(M.lightMap.value=y.lightMap,M.lightMapIntensity.value=y.lightMapIntensity,e(y.lightMap,M.lightMapTransform)),y.aoMap&&(M.aoMap.value=y.aoMap,M.aoMapIntensity.value=y.aoMapIntensity,e(y.aoMap,M.aoMapTransform))}function u(M,y){M.diffuse.value.copy(y.color),M.opacity.value=y.opacity,y.map&&(M.map.value=y.map,e(y.map,M.mapTransform))}function h(M,y){M.dashSize.value=y.dashSize,M.totalSize.value=y.dashSize+y.gapSize,M.scale.value=y.scale}function d(M,y,I,D){M.diffuse.value.copy(y.color),M.opacity.value=y.opacity,M.size.value=y.size*I,M.scale.value=D*.5,y.map&&(M.map.value=y.map,e(y.map,M.uvTransform)),y.alphaMap&&(M.alphaMap.value=y.alphaMap,e(y.alphaMap,M.alphaMapTransform)),y.alphaTest>0&&(M.alphaTest.value=y.alphaTest)}function p(M,y){M.diffuse.value.copy(y.color),M.opacity.value=y.opacity,M.rotation.value=y.rotation,y.map&&(M.map.value=y.map,e(y.map,M.mapTransform)),y.alphaMap&&(M.alphaMap.value=y.alphaMap,e(y.alphaMap,M.alphaMapTransform)),y.alphaTest>0&&(M.alphaTest.value=y.alphaTest)}function g(M,y){M.specular.value.copy(y.specular),M.shininess.value=Math.max(y.shininess,1e-4)}function _(M,y){y.gradientMap&&(M.gradientMap.value=y.gradientMap)}function v(M,y){M.metalness.value=y.metalness,y.metalnessMap&&(M.metalnessMap.value=y.metalnessMap,e(y.metalnessMap,M.metalnessMapTransform)),M.roughness.value=y.roughness,y.roughnessMap&&(M.roughnessMap.value=y.roughnessMap,e(y.roughnessMap,M.roughnessMapTransform)),y.envMap&&(M.envMapIntensity.value=y.envMapIntensity)}function x(M,y,I){M.ior.value=y.ior,y.sheen>0&&(M.sheenColor.value.copy(y.sheenColor).multiplyScalar(y.sheen),M.sheenRoughness.value=y.sheenRoughness,y.sheenColorMap&&(M.sheenColorMap.value=y.sheenColorMap,e(y.sheenColorMap,M.sheenColorMapTransform)),y.sheenRoughnessMap&&(M.sheenRoughnessMap.value=y.sheenRoughnessMap,e(y.sheenRoughnessMap,M.sheenRoughnessMapTransform))),y.clearcoat>0&&(M.clearcoat.value=y.clearcoat,M.clearcoatRoughness.value=y.clearcoatRoughness,y.clearcoatMap&&(M.clearcoatMap.value=y.clearcoatMap,e(y.clearcoatMap,M.clearcoatMapTransform)),y.clearcoatRoughnessMap&&(M.clearcoatRoughnessMap.value=y.clearcoatRoughnessMap,e(y.clearcoatRoughnessMap,M.clearcoatRoughnessMapTransform)),y.clearcoatNormalMap&&(M.clearcoatNormalMap.value=y.clearcoatNormalMap,e(y.clearcoatNormalMap,M.clearcoatNormalMapTransform),M.clearcoatNormalScale.value.copy(y.clearcoatNormalScale),y.side===ni&&M.clearcoatNormalScale.value.negate())),y.dispersion>0&&(M.dispersion.value=y.dispersion),y.iridescence>0&&(M.iridescence.value=y.iridescence,M.iridescenceIOR.value=y.iridescenceIOR,M.iridescenceThicknessMinimum.value=y.iridescenceThicknessRange[0],M.iridescenceThicknessMaximum.value=y.iridescenceThicknessRange[1],y.iridescenceMap&&(M.iridescenceMap.value=y.iridescenceMap,e(y.iridescenceMap,M.iridescenceMapTransform)),y.iridescenceThicknessMap&&(M.iridescenceThicknessMap.value=y.iridescenceThicknessMap,e(y.iridescenceThicknessMap,M.iridescenceThicknessMapTransform))),y.transmission>0&&(M.transmission.value=y.transmission,M.transmissionSamplerMap.value=I.texture,M.transmissionSamplerSize.value.set(I.width,I.height),y.transmissionMap&&(M.transmissionMap.value=y.transmissionMap,e(y.transmissionMap,M.transmissionMapTransform)),M.thickness.value=y.thickness,y.thicknessMap&&(M.thicknessMap.value=y.thicknessMap,e(y.thicknessMap,M.thicknessMapTransform)),M.attenuationDistance.value=y.attenuationDistance,M.attenuationColor.value.copy(y.attenuationColor)),y.anisotropy>0&&(M.anisotropyVector.value.set(y.anisotropy*Math.cos(y.anisotropyRotation),y.anisotropy*Math.sin(y.anisotropyRotation)),y.anisotropyMap&&(M.anisotropyMap.value=y.anisotropyMap,e(y.anisotropyMap,M.anisotropyMapTransform))),M.specularIntensity.value=y.specularIntensity,M.specularColor.value.copy(y.specularColor),y.specularColorMap&&(M.specularColorMap.value=y.specularColorMap,e(y.specularColorMap,M.specularColorMapTransform)),y.specularIntensityMap&&(M.specularIntensityMap.value=y.specularIntensityMap,e(y.specularIntensityMap,M.specularIntensityMapTransform))}function b(M,y){y.matcap&&(M.matcap.value=y.matcap)}function C(M,y){const I=t.get(y).light;M.referencePosition.value.setFromMatrixPosition(I.matrixWorld),M.nearDistance.value=I.shadow.camera.near,M.farDistance.value=I.shadow.camera.far}return{refreshFogUniforms:a,refreshMaterialUniforms:o}}function rR(s,t,e,a){let o={},l={},u=[];const h=s.getParameter(s.MAX_UNIFORM_BUFFER_BINDINGS);function d(A,O){const U=O.program;a.uniformBlockBinding(A,U)}function p(A,O){let U=o[A.id];U===void 0&&(M(A),U=g(A),o[A.id]=U,A.addEventListener("dispose",I));const z=O.program;a.updateUBOMapping(A,z);const T=t.render.frame;l[A.id]!==T&&(v(A),l[A.id]=T)}function g(A){const O=_();A.__bindingPointIndex=O;const U=s.createBuffer(),z=A.__size,T=A.usage;return s.bindBuffer(s.UNIFORM_BUFFER,U),s.bufferData(s.UNIFORM_BUFFER,z,T),s.bindBuffer(s.UNIFORM_BUFFER,null),s.bindBufferBase(s.UNIFORM_BUFFER,O,U),U}function _(){for(let A=0;A<h;A++)if(u.indexOf(A)===-1)return u.push(A),A;return Oe("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function v(A){const O=o[A.id],U=A.uniforms,z=A.__cache;s.bindBuffer(s.UNIFORM_BUFFER,O);for(let T=0,P=U.length;T<P;T++){const k=U[T];if(Array.isArray(k))for(let H=0,K=k.length;H<K;H++)x(k[H],T,H,z);else x(k,T,0,z)}s.bindBuffer(s.UNIFORM_BUFFER,null)}function x(A,O,U,z){if(C(A,O,U,z)===!0){const T=A.__offset,P=A.value;if(Array.isArray(P)){let k=0;for(let H=0;H<P.length;H++){const K=P[H],ft=y(K);b(K,A.__data,k),typeof K!="number"&&typeof K!="boolean"&&!K.isMatrix3&&!ArrayBuffer.isView(K)&&(k+=ft.storage/Float32Array.BYTES_PER_ELEMENT)}}else b(P,A.__data,0);s.bufferSubData(s.UNIFORM_BUFFER,T,A.__data)}}function b(A,O,U){typeof A=="number"||typeof A=="boolean"?O[0]=A:A.isMatrix3?(O[0]=A.elements[0],O[1]=A.elements[1],O[2]=A.elements[2],O[3]=0,O[4]=A.elements[3],O[5]=A.elements[4],O[6]=A.elements[5],O[7]=0,O[8]=A.elements[6],O[9]=A.elements[7],O[10]=A.elements[8],O[11]=0):ArrayBuffer.isView(A)?O.set(new A.constructor(A.buffer,A.byteOffset,O.length)):A.toArray(O,U)}function C(A,O,U,z){const T=A.value,P=O+"_"+U;if(z[P]===void 0)return typeof T=="number"||typeof T=="boolean"?z[P]=T:ArrayBuffer.isView(T)?z[P]=T.slice():z[P]=T.clone(),!0;{const k=z[P];if(typeof T=="number"||typeof T=="boolean"){if(k!==T)return z[P]=T,!0}else{if(ArrayBuffer.isView(T))return!0;if(k.equals(T)===!1)return k.copy(T),!0}}return!1}function M(A){const O=A.uniforms;let U=0;const z=16;for(let P=0,k=O.length;P<k;P++){const H=Array.isArray(O[P])?O[P]:[O[P]];for(let K=0,ft=H.length;K<ft;K++){const dt=H[K],J=Array.isArray(dt.value)?dt.value:[dt.value];for(let F=0,N=J.length;F<N;F++){const V=J[F],nt=y(V),mt=U%z,L=mt%nt.boundary,X=mt+L;U+=L,X!==0&&z-X<nt.storage&&(U+=z-X),dt.__data=new Float32Array(nt.storage/Float32Array.BYTES_PER_ELEMENT),dt.__offset=U,U+=nt.storage}}}const T=U%z;return T>0&&(U+=z-T),A.__size=U,A.__cache={},this}function y(A){const O={boundary:0,storage:0};return typeof A=="number"||typeof A=="boolean"?(O.boundary=4,O.storage=4):A.isVector2?(O.boundary=8,O.storage=8):A.isVector3||A.isColor?(O.boundary=16,O.storage=12):A.isVector4?(O.boundary=16,O.storage=16):A.isMatrix3?(O.boundary=48,O.storage=48):A.isMatrix4?(O.boundary=64,O.storage=64):A.isTexture?ge("WebGLRenderer: Texture samplers can not be part of an uniforms group."):ArrayBuffer.isView(A)?(O.boundary=16,O.storage=A.byteLength):ge("WebGLRenderer: Unsupported uniform value type.",A),O}function I(A){const O=A.target;O.removeEventListener("dispose",I);const U=u.indexOf(O.__bindingPointIndex);u.splice(U,1),s.deleteBuffer(o[O.id]),delete o[O.id],delete l[O.id]}function D(){for(const A in o)s.deleteBuffer(o[A]);u=[],o={},l={}}return{bind:d,update:p,dispose:D}}const oR=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]);let ca=null;function lR(){return ca===null&&(ca=new jy(oR,16,16,Sr,$a),ca.name="DFG_LUT",ca.minFilter=ei,ca.magFilter=ei,ca.wrapS=qa,ca.wrapT=qa,ca.generateMipmaps=!1,ca.needsUpdate=!0),ca}class cR{constructor(t={}){const{canvas:e=XE(),context:a=null,depth:o=!0,stencil:l=!1,alpha:u=!1,antialias:h=!1,premultipliedAlpha:d=!0,preserveDrawingBuffer:p=!1,powerPreference:g="default",failIfMajorPerformanceCaveat:_=!1,reversedDepthBuffer:v=!1,outputBufferType:x=Di}=t;this.isWebGLRenderer=!0;let b;if(a!==null){if(typeof WebGLRenderingContext<"u"&&a instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");b=a.getContextAttributes().alpha}else b=u;const C=x,M=new Set([km,Vm,Gm]),y=new Set([Di,ga,rc,oc,zm,Fm]),I=new Uint32Array(4),D=new Int32Array(4),A=new q;let O=null,U=null;const z=[],T=[];let P=null;this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=pa,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const k=this;let H=!1,K=null,ft=null,dt=null,J=null;this._outputColorSpace=Xn;let F=0,N=0,V=null,nt=-1,mt=null;const L=new pn,X=new pn;let _t=null;const Ct=new pe(0);let Lt=0,et=e.width,Mt=e.height,Et=1,zt=null,oe=null;const ae=new pn(0,0,et,Mt),Pe=new pn(0,0,et,Mt);let me=!1;const Tt=new Jm;let Rt=!1,wt=!1;const kt=new en,Gt=new q,le=new pn,ne={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let he=!1;function xe(){return V===null?Et:1}let W=a;function Me(w,Q){return e.getContext(w,Q)}try{const w={alpha:!0,depth:o,stencil:l,antialias:h,premultipliedAlpha:d,preserveDrawingBuffer:p,powerPreference:g,failIfMajorPerformanceCaveat:_};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${Om}`),e.addEventListener("webglcontextlost",cn,!1),e.addEventListener("webglcontextrestored",Xe,!1),e.addEventListener("webglcontextcreationerror",gi,!1),W===null){const Q="webgl2";if(W=Me(Q,w),W===null)throw Me(Q)?new Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes."):new Error("THREE.WebGLRenderer: Error creating WebGL context.")}}catch(w){throw Oe("WebGLRenderer: "+w.message),w}let we,B,E,tt,ot,gt,Dt,Bt,pt,vt,Ot,Yt,Vt,Ft,re,ce,ve,Z,Nt,yt,It,qt,At;function ee(){we=new lw(W),we.init(),It=new j3(W,we),B=new tw(W,we,t,It),E=new Q3(W,we),B.reversedDepthBuffer&&v&&E.buffers.depth.setReversed(!0),ft=W.createFramebuffer(),dt=W.createFramebuffer(),J=W.createFramebuffer(),tt=new fw(W),ot=new I3,gt=new $3(W,we,E,ot,B,It,tt),Dt=new ow(k),Bt=new mT(W),qt=new $2(W,Bt),pt=new cw(W,Bt,tt,qt),vt=new dw(W,pt,Bt,qt,tt),Z=new hw(W,B,gt),re=new ew(ot),Ot=new B3(k,Dt,we,B,qt,re),Yt=new sR(k,ot),Vt=new F3,Ft=new W3(we),ve=new Q2(k,Dt,E,vt,b,d),ce=new J3(k,vt,B),At=new rR(W,tt,B,E),Nt=new j2(W,we,tt),yt=new uw(W,we,tt),tt.programs=Ot.programs,k.capabilities=B,k.extensions=we,k.properties=ot,k.renderLists=Vt,k.shadowMap=ce,k.state=E,k.info=tt}ee(),C!==Di&&(P=new mw(C,e.width,e.height,h,o,l));const Qt=new iR(k,W);this.xr=Qt,this.getContext=function(){return W},this.getContextAttributes=function(){return W.getContextAttributes()},this.forceContextLoss=function(){const w=we.get("WEBGL_lose_context");w&&w.loseContext()},this.forceContextRestore=function(){const w=we.get("WEBGL_lose_context");w&&w.restoreContext()},this.getPixelRatio=function(){return Et},this.setPixelRatio=function(w){w!==void 0&&(Et=w,this.setSize(et,Mt,!1))},this.getSize=function(w){return w.set(et,Mt)},this.setSize=function(w,Q,lt=!0){if(Qt.isPresenting){ge("WebGLRenderer: Can't change size while VR device is presenting.");return}et=w,Mt=Q,e.width=Math.floor(w*Et),e.height=Math.floor(Q*Et),lt===!0&&(e.style.width=w+"px",e.style.height=Q+"px"),P!==null&&P.setSize(e.width,e.height),this.setViewport(0,0,w,Q)},this.getDrawingBufferSize=function(w){return w.set(et*Et,Mt*Et).floor()},this.setDrawingBufferSize=function(w,Q,lt){et=w,Mt=Q,Et=lt,e.width=Math.floor(w*lt),e.height=Math.floor(Q*lt),this.setViewport(0,0,w,Q)},this.setEffects=function(w){if(C===Di){Oe("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(w){for(let Q=0;Q<w.length;Q++)if(w[Q].isOutputPass===!0){ge("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}P.setEffects(w||[])},this.getCurrentViewport=function(w){return w.copy(L)},this.getViewport=function(w){return w.copy(ae)},this.setViewport=function(w,Q,lt,st){w.isVector4?ae.set(w.x,w.y,w.z,w.w):ae.set(w,Q,lt,st),E.viewport(L.copy(ae).multiplyScalar(Et).round())},this.getScissor=function(w){return w.copy(Pe)},this.setScissor=function(w,Q,lt,st){w.isVector4?Pe.set(w.x,w.y,w.z,w.w):Pe.set(w,Q,lt,st),E.scissor(X.copy(Pe).multiplyScalar(Et).round())},this.getScissorTest=function(){return me},this.setScissorTest=function(w){E.setScissorTest(me=w)},this.setOpaqueSort=function(w){zt=w},this.setTransparentSort=function(w){oe=w},this.getClearColor=function(w){return w.copy(ve.getClearColor())},this.setClearColor=function(){ve.setClearColor(...arguments)},this.getClearAlpha=function(){return ve.getClearAlpha()},this.setClearAlpha=function(){ve.setClearAlpha(...arguments)},this.clear=function(w=!0,Q=!0,lt=!0){let st=0;if(w){let rt=!1;if(V!==null){const Xt=V.texture.format;rt=M.has(Xt)}if(rt){const Xt=V.texture.type,Jt=y.has(Xt),Ht=ve.getClearColor(),jt=ve.getClearAlpha(),$t=Ht.r,ue=Ht.g,be=Ht.b;Jt?(I[0]=$t,I[1]=ue,I[2]=be,I[3]=jt,W.clearBufferuiv(W.COLOR,0,I)):(D[0]=$t,D[1]=ue,D[2]=be,D[3]=jt,W.clearBufferiv(W.COLOR,0,D))}else st|=W.COLOR_BUFFER_BIT}Q&&(st|=W.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),lt&&(st|=W.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),st!==0&&W.clear(st)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(w){w.setRenderer(this),K=w},this.dispose=function(){e.removeEventListener("webglcontextlost",cn,!1),e.removeEventListener("webglcontextrestored",Xe,!1),e.removeEventListener("webglcontextcreationerror",gi,!1),ve.dispose(),Vt.dispose(),Ft.dispose(),ot.dispose(),Dt.dispose(),vt.dispose(),qt.dispose(),At.dispose(),Ot.dispose(),Qt.dispose(),Qt.removeEventListener("sessionstart",Mn),Qt.removeEventListener("sessionend",zn),ci.stop()};function cn(w){w.preventDefault(),mf("WebGLRenderer: Context Lost."),H=!0}function Xe(){mf("WebGLRenderer: Context Restored."),H=!1;const w=tt.autoReset,Q=ce.enabled,lt=ce.autoUpdate,st=ce.needsUpdate,rt=ce.type;ee(),tt.autoReset=w,ce.enabled=Q,ce.autoUpdate=lt,ce.needsUpdate=st,ce.type=rt}function gi(w){Oe("WebGLRenderer: A WebGL context could not be created. Reason: ",w.statusMessage)}function vi(w){const Q=w.target;Q.removeEventListener("dispose",vi),qo(Q)}function qo(w){Yo(w),ot.remove(w)}function Yo(w){const Q=ot.get(w).programs;Q!==void 0&&(Q.forEach(function(lt){Ot.releaseProgram(lt)}),w.isShaderMaterial&&Ot.releaseShaderCache(w))}this.renderBufferDirect=function(w,Q,lt,st,rt,Xt){Q===null&&(Q=ne);const Jt=rt.isMesh&&rt.matrixWorld.determinantAffine()<0,Ht=is(w,Q,lt,st,rt);E.setMaterial(st,Jt);let jt=lt.index,$t=1;if(st.wireframe===!0){if(jt=pt.getWireframeAttribute(lt),jt===void 0)return;$t=2}const ue=lt.drawRange,be=lt.attributes.position;let se=ue.start*$t,ze=(ue.start+ue.count)*$t;Xt!==null&&(se=Math.max(se,Xt.start*$t),ze=Math.min(ze,(Xt.start+Xt.count)*$t)),jt!==null?(se=Math.max(se,0),ze=Math.min(ze,jt.count)):be!=null&&(se=Math.max(se,0),ze=Math.min(ze,be.count));const un=ze-se;if(un<0||un===1/0)return;qt.setup(rt,st,Ht,lt,jt);let nn,We=Nt;if(jt!==null&&(nn=Bt.get(jt),We=yt,We.setIndex(nn)),rt.isMesh)st.wireframe===!0?(E.setLineWidth(st.wireframeLinewidth*xe()),We.setMode(W.LINES)):We.setMode(W.TRIANGLES);else if(rt.isLine){let qe=st.linewidth;qe===void 0&&(qe=1),E.setLineWidth(qe*xe()),rt.isLineSegments?We.setMode(W.LINES):rt.isLineLoop?We.setMode(W.LINE_LOOP):We.setMode(W.LINE_STRIP)}else rt.isPoints?We.setMode(W.POINTS):rt.isSprite&&We.setMode(W.TRIANGLES);if(rt.isBatchedMesh)if(we.get("WEBGL_multi_draw"))We.renderMultiDraw(rt._multiDrawStarts,rt._multiDrawCounts,rt._multiDrawCount);else{const qe=rt._multiDrawStarts,Zt=rt._multiDrawCounts,Zn=rt._multiDrawCount,Re=jt?Bt.get(jt).bytesPerElement:1,Dn=ot.get(st).currentProgram.getUniforms();for(let _i=0;_i<Zn;_i++)Dn.setValue(W,"_gl_DrawID",_i),We.render(qe[_i]/Re,Zt[_i])}else if(rt.isInstancedMesh)We.renderInstances(se,un,rt.count);else if(lt.isInstancedBufferGeometry){const qe=lt._maxInstanceCount!==void 0?lt._maxInstanceCount:1/0,Zt=Math.min(lt.instanceCount,qe);We.renderInstances(se,un,Zt)}else We.render(se,un)};function Zo(w,Q,lt){w.transparent===!0&&w.side===$i&&w.forceSinglePass===!1?(w.side=ni,w.needsUpdate=!0,ns(w,Q,lt),w.side=Fs,w.needsUpdate=!0,ns(w,Q,lt),w.side=$i):ns(w,Q,lt)}this.compile=function(w,Q,lt=null){lt===null&&(lt=w),U=Ft.get(lt),U.init(Q),T.push(U),lt.traverseVisible(function(rt){rt.isLight&&rt.layers.test(Q.layers)&&(U.pushLight(rt),rt.castShadow&&U.pushShadow(rt))}),w!==lt&&w.traverseVisible(function(rt){rt.isLight&&rt.layers.test(Q.layers)&&(U.pushLight(rt),rt.castShadow&&U.pushShadow(rt))}),U.setupLights();const st=new Set;return w.traverse(function(rt){if(!(rt.isMesh||rt.isPoints||rt.isLine||rt.isSprite))return;const Xt=rt.material;if(Xt)if(Array.isArray(Xt))for(let Jt=0;Jt<Xt.length;Jt++){const Ht=Xt[Jt];Zo(Ht,lt,rt),st.add(Ht)}else Zo(Xt,lt,rt),st.add(Xt)}),U=T.pop(),st},this.compileAsync=function(w,Q,lt=null){const st=this.compile(w,Q,lt);return new Promise(rt=>{function Xt(){if(st.forEach(function(Jt){ot.get(Jt).currentProgram.isReady()&&st.delete(Jt)}),st.size===0){rt(w);return}setTimeout(Xt,10)}we.get("KHR_parallel_shader_compile")!==null?Xt():setTimeout(Xt,10)})};let wr=null;function na(w){wr&&wr(w)}function Mn(){ci.stop()}function zn(){ci.start()}const ci=new vS;ci.setAnimationLoop(na),typeof self<"u"&&ci.setContext(self),this.setAnimationLoop=function(w){wr=w,Qt.setAnimationLoop(w),w===null?ci.stop():ci.start()},Qt.addEventListener("sessionstart",Mn),Qt.addEventListener("sessionend",zn),this.render=function(w,Q){if(Q!==void 0&&Q.isCamera!==!0){Oe("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(H===!0)return;K!==null&&K.renderStart(w,Q);const lt=Qt.enabled===!0&&Qt.isPresenting===!0,st=P!==null&&(V===null||lt)&&P.begin(k,V);if(w.matrixWorldAutoUpdate===!0&&w.updateMatrixWorld(),Q.parent===null&&Q.matrixWorldAutoUpdate===!0&&Q.updateMatrixWorld(),Qt.enabled===!0&&Qt.isPresenting===!0&&(P===null||P.isCompositing()===!1)&&(Qt.cameraAutoUpdate===!0&&Qt.updateCamera(Q),Q=Qt.getCamera()),w.isScene===!0&&w.onBeforeRender(k,w,Q,V),U=Ft.get(w,T.length),U.init(Q),U.state.textureUnits=gt.getTextureUnits(),T.push(U),kt.multiplyMatrices(Q.projectionMatrix,Q.matrixWorldInverse),Tt.setFromProjectionMatrix(kt,da,Q.reversedDepth),wt=this.localClippingEnabled,Rt=re.init(this.clippingPlanes,wt),O=Vt.get(w,z.length),O.init(),z.push(O),Qt.enabled===!0&&Qt.isPresenting===!0){const Jt=k.xr.getDepthSensingMesh();Jt!==null&&Vs(Jt,Q,-1/0,k.sortObjects)}Vs(w,Q,0,k.sortObjects),O.finish(),k.sortObjects===!0&&O.sort(zt,oe,Q.reversedDepth),he=Qt.enabled===!1||Qt.isPresenting===!1||Qt.hasDepthSensing()===!1,he&&ve.addToRenderList(O,w),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),Rt===!0&&re.beginShadows();const rt=U.state.shadowsArray;if(ce.render(rt,w,Q),Rt===!0&&re.endShadows(),(st&&P.hasRenderPass())===!1){const Jt=O.opaque,Ht=O.transmissive;if(U.setupLights(),Q.isArrayCamera){const jt=Q.cameras;if(Ht.length>0)for(let $t=0,ue=jt.length;$t<ue;$t++){const be=jt[$t];gc(Jt,Ht,w,be)}he&&ve.render(w);for(let $t=0,ue=jt.length;$t<ue;$t++){const be=jt[$t];mc(O,w,be,be.viewport)}}else Ht.length>0&&gc(Jt,Ht,w,Q),he&&ve.render(w),mc(O,w,Q)}V!==null&&N===0&&(gt.updateMultisampleRenderTarget(V),gt.updateRenderTargetMipmap(V)),st&&P.end(k),w.isScene===!0&&w.onAfterRender(k,w,Q),qt.resetDefaultState(),nt=-1,mt=null,T.pop(),T.length>0?(U=T[T.length-1],gt.setTextureUnits(U.state.textureUnits),Rt===!0&&re.setGlobalState(k.clippingPlanes,U.state.camera)):U=null,z.pop(),z.length>0?O=z[z.length-1]:O=null,K!==null&&K.renderEnd()};function Vs(w,Q,lt,st){if(w.visible===!1)return;if(w.layers.test(Q.layers)){if(w.isGroup)lt=w.renderOrder;else if(w.isLOD)w.autoUpdate===!0&&w.update(Q);else if(w.isLightProbeGrid)U.pushLightProbeGrid(w);else if(w.isLight)U.pushLight(w),w.castShadow&&U.pushShadow(w);else if(w.isSprite){if(!w.frustumCulled||Tt.intersectsSprite(w)){st&&le.setFromMatrixPosition(w.matrixWorld).applyMatrix4(kt);const Jt=vt.update(w),Ht=w.material;Ht.visible&&O.push(w,Jt,Ht,lt,le.z,null)}}else if((w.isMesh||w.isLine||w.isPoints)&&(!w.frustumCulled||Tt.intersectsObject(w))){const Jt=vt.update(w),Ht=w.material;if(st&&(w.boundingSphere!==void 0?(w.boundingSphere===null&&w.computeBoundingSphere(),le.copy(w.boundingSphere.center)):(Jt.boundingSphere===null&&Jt.computeBoundingSphere(),le.copy(Jt.boundingSphere.center)),le.applyMatrix4(w.matrixWorld).applyMatrix4(kt)),Array.isArray(Ht)){const jt=Jt.groups;for(let $t=0,ue=jt.length;$t<ue;$t++){const be=jt[$t],se=Ht[be.materialIndex];se&&se.visible&&O.push(w,Jt,se,lt,le.z,be)}}else Ht.visible&&O.push(w,Jt,Ht,lt,le.z,null)}}const Xt=w.children;for(let Jt=0,Ht=Xt.length;Jt<Ht;Jt++)Vs(Xt[Jt],Q,lt,st)}function mc(w,Q,lt,st){const{opaque:rt,transmissive:Xt,transparent:Jt}=w;U.setupLightsView(lt),Rt===!0&&re.setGlobalState(k.clippingPlanes,lt),st&&E.viewport(L.copy(st)),rt.length>0&&ks(rt,Q,lt),Xt.length>0&&ks(Xt,Q,lt),Jt.length>0&&ks(Jt,Q,lt),E.buffers.depth.setTest(!0),E.buffers.depth.setMask(!0),E.buffers.color.setMask(!0),E.setPolygonOffset(!1)}function gc(w,Q,lt,st){if((lt.isScene===!0?lt.overrideMaterial:null)!==null)return;if(U.state.transmissionRenderTarget[st.id]===void 0){const se=we.has("EXT_color_buffer_half_float")||we.has("EXT_color_buffer_float");U.state.transmissionRenderTarget[st.id]=new ma(1,1,{generateMipmaps:!0,type:se?$a:Di,minFilter:vr,samples:Math.max(4,B.samples),stencilBuffer:l,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Ie.workingColorSpace})}const Xt=U.state.transmissionRenderTarget[st.id],Jt=st.viewport||L;Xt.setSize(Jt.z*k.transmissionResolutionScale,Jt.w*k.transmissionResolutionScale);const Ht=k.getRenderTarget(),jt=k.getActiveCubeFace(),$t=k.getActiveMipmapLevel();k.setRenderTarget(Xt),k.getClearColor(Ct),Lt=k.getClearAlpha(),Lt<1&&k.setClearColor(16777215,.5),k.clear(),he&&ve.render(lt);const ue=k.toneMapping;k.toneMapping=pa;const be=st.viewport;if(st.viewport!==void 0&&(st.viewport=void 0),U.setupLightsView(st),Rt===!0&&re.setGlobalState(k.clippingPlanes,st),ks(w,lt,st),gt.updateMultisampleRenderTarget(Xt),gt.updateRenderTargetMipmap(Xt),we.has("WEBGL_multisampled_render_to_texture")===!1){let se=!1;for(let ze=0,un=Q.length;ze<un;ze++){const nn=Q[ze],{object:We,geometry:qe,material:Zt,group:Zn}=nn;if(Zt.side===$i&&We.layers.test(st.layers)){const Re=Zt.side;Zt.side=ni,Zt.needsUpdate=!0,es(We,lt,st,qe,Zt,Zn),Zt.side=Re,Zt.needsUpdate=!0,se=!0}}se===!0&&(gt.updateMultisampleRenderTarget(Xt),gt.updateRenderTargetMipmap(Xt))}k.setRenderTarget(Ht,jt,$t),k.setClearColor(Ct,Lt),be!==void 0&&(st.viewport=be),k.toneMapping=ue}function ks(w,Q,lt){const st=Q.isScene===!0?Q.overrideMaterial:null;for(let rt=0,Xt=w.length;rt<Xt;rt++){const Jt=w[rt],{object:Ht,geometry:jt,group:$t}=Jt;let ue=Jt.material;ue.allowOverride===!0&&st!==null&&(ue=st),Ht.layers.test(lt.layers)&&es(Ht,Q,lt,jt,ue,$t)}}function es(w,Q,lt,st,rt,Xt){w.onBeforeRender(k,Q,lt,st,rt,Xt),w.modelViewMatrix.multiplyMatrices(lt.matrixWorldInverse,w.matrixWorld),w.normalMatrix.getNormalMatrix(w.modelViewMatrix),rt.onBeforeRender(k,Q,lt,st,w,Xt),rt.transparent===!0&&rt.side===$i&&rt.forceSinglePass===!1?(rt.side=ni,rt.needsUpdate=!0,k.renderBufferDirect(lt,Q,st,rt,w,Xt),rt.side=Fs,rt.needsUpdate=!0,k.renderBufferDirect(lt,Q,st,rt,w,Xt),rt.side=$i):k.renderBufferDirect(lt,Q,st,rt,w,Xt),w.onAfterRender(k,Q,lt,st,rt,Xt)}function ns(w,Q,lt){Q.isScene!==!0&&(Q=ne);const st=ot.get(w),rt=U.state.lights,Xt=U.state.shadowsArray,Jt=rt.state.version,Ht=Ot.getParameters(w,rt.state,Xt,Q,lt,U.state.lightProbeGridArray),jt=Ot.getProgramCacheKey(Ht);let $t=st.programs;st.environment=w.isMeshStandardMaterial||w.isMeshLambertMaterial||w.isMeshPhongMaterial?Q.environment:null,st.fog=Q.fog;const ue=w.isMeshStandardMaterial||w.isMeshLambertMaterial&&!w.envMap||w.isMeshPhongMaterial&&!w.envMap;st.envMap=Dt.get(w.envMap||st.environment,ue),st.envMapRotation=st.environment!==null&&w.envMap===null?Q.environmentRotation:w.envMapRotation,$t===void 0&&(w.addEventListener("dispose",vi),$t=new Map,st.programs=$t);let be=$t.get(jt);if(be!==void 0){if(st.currentProgram===be&&st.lightsStateVersion===Jt)return xa(w,Ht),be}else Ht.uniforms=Ot.getUniforms(w),K!==null&&w.isNodeMaterial&&K.build(w,lt,Ht),w.onBeforeCompile(Ht,k),be=Ot.acquireProgram(Ht,jt),$t.set(jt,be),st.uniforms=Ht.uniforms;const se=st.uniforms;return(!w.isShaderMaterial&&!w.isRawShaderMaterial||w.clipping===!0)&&(se.clippingPlanes=re.uniform),xa(w,Ht),st.needsLights=vc(w),st.lightsStateVersion=Jt,st.needsLights&&(se.ambientLightColor.value=rt.state.ambient,se.lightProbe.value=rt.state.probe,se.directionalLights.value=rt.state.directional,se.directionalLightShadows.value=rt.state.directionalShadow,se.spotLights.value=rt.state.spot,se.spotLightShadows.value=rt.state.spotShadow,se.rectAreaLights.value=rt.state.rectArea,se.ltc_1.value=rt.state.rectAreaLTC1,se.ltc_2.value=rt.state.rectAreaLTC2,se.pointLights.value=rt.state.point,se.pointLightShadows.value=rt.state.pointShadow,se.hemisphereLights.value=rt.state.hemi,se.directionalShadowMatrix.value=rt.state.directionalShadowMatrix,se.spotLightMatrix.value=rt.state.spotLightMatrix,se.spotLightMap.value=rt.state.spotLightMap,se.pointShadowMatrix.value=rt.state.pointShadowMatrix),st.lightProbeGrid=U.state.lightProbeGridArray.length>0,st.currentProgram=be,st.uniformsList=null,be}function _a(w){if(w.uniformsList===null){const Q=w.currentProgram.getUniforms();w.uniformsList=rf.seqWithValue(Q.seq,w.uniforms)}return w.uniformsList}function xa(w,Q){const lt=ot.get(w);lt.outputColorSpace=Q.outputColorSpace,lt.batching=Q.batching,lt.batchingColor=Q.batchingColor,lt.instancing=Q.instancing,lt.instancingColor=Q.instancingColor,lt.instancingMorph=Q.instancingMorph,lt.skinning=Q.skinning,lt.morphTargets=Q.morphTargets,lt.morphNormals=Q.morphNormals,lt.morphColors=Q.morphColors,lt.morphTargetsCount=Q.morphTargetsCount,lt.numClippingPlanes=Q.numClippingPlanes,lt.numIntersection=Q.numClipIntersection,lt.vertexAlphas=Q.vertexAlphas,lt.vertexTangents=Q.vertexTangents,lt.toneMapping=Q.toneMapping}function Xs(w,Q){if(w.length===0)return null;if(w.length===1)return w[0].texture!==null?w[0]:null;A.setFromMatrixPosition(Q.matrixWorld);for(let lt=0,st=w.length;lt<st;lt++){const rt=w[lt];if(rt.texture!==null&&rt.boundingBox.containsPoint(A))return rt}return null}function is(w,Q,lt,st,rt){Q.isScene!==!0&&(Q=ne),gt.resetTextureUnits();const Xt=Q.fog,Jt=st.isMeshStandardMaterial||st.isMeshLambertMaterial||st.isMeshPhongMaterial?Q.environment:null,Ht=V===null?k.outputColorSpace:V.isXRRenderTarget===!0?V.texture.colorSpace:Ie.workingColorSpace,jt=st.isMeshStandardMaterial||st.isMeshLambertMaterial&&!st.envMap||st.isMeshPhongMaterial&&!st.envMap,$t=Dt.get(st.envMap||Jt,jt),ue=st.vertexColors===!0&&!!lt.attributes.color&&lt.attributes.color.itemSize===4,be=!!lt.attributes.tangent&&(!!st.normalMap||st.anisotropy>0),se=!!lt.morphAttributes.position,ze=!!lt.morphAttributes.normal,un=!!lt.morphAttributes.color;let nn=pa;st.toneMapped&&(V===null||V.isXRRenderTarget===!0)&&(nn=k.toneMapping);const We=lt.morphAttributes.position||lt.morphAttributes.normal||lt.morphAttributes.color,qe=We!==void 0?We.length:0,Zt=ot.get(st),Zn=U.state.lights;if(Rt===!0&&(wt===!0||w!==mt)){const ke=w===mt&&st.id===nt;re.setState(st,w,ke)}let Re=!1;st.version===Zt.__version?(Zt.needsLights&&Zt.lightsStateVersion!==Zn.state.version||Zt.outputColorSpace!==Ht||rt.isBatchedMesh&&Zt.batching===!1||!rt.isBatchedMesh&&Zt.batching===!0||rt.isBatchedMesh&&Zt.batchingColor===!0&&rt.colorTexture===null||rt.isBatchedMesh&&Zt.batchingColor===!1&&rt.colorTexture!==null||rt.isInstancedMesh&&Zt.instancing===!1||!rt.isInstancedMesh&&Zt.instancing===!0||rt.isSkinnedMesh&&Zt.skinning===!1||!rt.isSkinnedMesh&&Zt.skinning===!0||rt.isInstancedMesh&&Zt.instancingColor===!0&&rt.instanceColor===null||rt.isInstancedMesh&&Zt.instancingColor===!1&&rt.instanceColor!==null||rt.isInstancedMesh&&Zt.instancingMorph===!0&&rt.morphTexture===null||rt.isInstancedMesh&&Zt.instancingMorph===!1&&rt.morphTexture!==null||Zt.envMap!==$t||st.fog===!0&&Zt.fog!==Xt||Zt.numClippingPlanes!==void 0&&(Zt.numClippingPlanes!==re.numPlanes||Zt.numIntersection!==re.numIntersection)||Zt.vertexAlphas!==ue||Zt.vertexTangents!==be||Zt.morphTargets!==se||Zt.morphNormals!==ze||Zt.morphColors!==un||Zt.toneMapping!==nn||Zt.morphTargetsCount!==qe||!!Zt.lightProbeGrid!=U.state.lightProbeGridArray.length>0)&&(Re=!0):(Re=!0,Zt.__version=st.version);let Dn=Zt.currentProgram;Re===!0&&(Dn=ns(st,Q,rt),K&&st.isNodeMaterial&&K.onUpdateProgram(st,Dn,Zt));let _i=!1,Xi=!1,xi=!1;const Ye=Dn.getUniforms(),fn=Zt.uniforms;if(E.useProgram(Dn.program)&&(_i=!0,Xi=!0,xi=!0),st.id!==nt&&(nt=st.id,Xi=!0),Zt.needsLights){const ke=Xs(U.state.lightProbeGridArray,rt);Zt.lightProbeGrid!==ke&&(Zt.lightProbeGrid=ke,Xi=!0)}if(_i||mt!==w){E.buffers.depth.getReversed()&&w.reversedDepth!==!0&&(w._reversedDepth=!0,w.updateProjectionMatrix()),Ye.setValue(W,"projectionMatrix",w.projectionMatrix),Ye.setValue(W,"viewMatrix",w.matrixWorldInverse);const ia=Ye.map.cameraPosition;ia!==void 0&&ia.setValue(W,Gt.setFromMatrixPosition(w.matrixWorld)),B.logarithmicDepthBuffer&&Ye.setValue(W,"logDepthBufFC",2/(Math.log(w.far+1)/Math.LN2)),(st.isMeshPhongMaterial||st.isMeshToonMaterial||st.isMeshLambertMaterial||st.isMeshBasicMaterial||st.isMeshStandardMaterial||st.isShaderMaterial)&&Ye.setValue(W,"isOrthographic",w.isOrthographicCamera===!0),mt!==w&&(mt=w,Xi=!0,xi=!0)}if(Zt.needsLights&&(Zn.state.directionalShadowMap.length>0&&Ye.setValue(W,"directionalShadowMap",Zn.state.directionalShadowMap,gt),Zn.state.spotShadowMap.length>0&&Ye.setValue(W,"spotShadowMap",Zn.state.spotShadowMap,gt),Zn.state.pointShadowMap.length>0&&Ye.setValue(W,"pointShadowMap",Zn.state.pointShadowMap,gt)),rt.isSkinnedMesh){Ye.setOptional(W,rt,"bindMatrix"),Ye.setOptional(W,rt,"bindMatrixInverse");const ke=rt.skeleton;ke&&(ke.boneTexture===null&&ke.computeBoneTexture(),Ye.setValue(W,"boneTexture",ke.boneTexture,gt))}rt.isBatchedMesh&&(Ye.setOptional(W,rt,"batchingTexture"),Ye.setValue(W,"batchingTexture",rt._matricesTexture,gt),Ye.setOptional(W,rt,"batchingIdTexture"),Ye.setValue(W,"batchingIdTexture",rt._indirectTexture,gt),Ye.setOptional(W,rt,"batchingColorTexture"),rt._colorsTexture!==null&&Ye.setValue(W,"batchingColorTexture",rt._colorsTexture,gt));const Wi=lt.morphAttributes;if((Wi.position!==void 0||Wi.normal!==void 0||Wi.color!==void 0)&&Z.update(rt,lt,Dn),(Xi||Zt.receiveShadow!==rt.receiveShadow)&&(Zt.receiveShadow=rt.receiveShadow,Ye.setValue(W,"receiveShadow",rt.receiveShadow)),(st.isMeshStandardMaterial||st.isMeshLambertMaterial||st.isMeshPhongMaterial)&&st.envMap===null&&Q.environment!==null&&(fn.envMapIntensity.value=Q.environmentIntensity),fn.dfgLUT!==void 0&&(fn.dfgLUT.value=lR()),Xi){if(Ye.setValue(W,"toneMappingExposure",k.toneMappingExposure),Zt.needsLights&&bn(fn,xi),Xt&&st.fog===!0&&Yt.refreshFogUniforms(fn,Xt),Yt.refreshMaterialUniforms(fn,st,Et,Mt,U.state.transmissionRenderTarget[w.id]),Zt.needsLights&&Zt.lightProbeGrid){const ke=Zt.lightProbeGrid;fn.probesSH.value=ke.texture,fn.probesMin.value.copy(ke.boundingBox.min),fn.probesMax.value.copy(ke.boundingBox.max),fn.probesResolution.value.copy(ke.resolution)}rf.upload(W,_a(Zt),fn,gt)}if(st.isShaderMaterial&&st.uniformsNeedUpdate===!0&&(rf.upload(W,_a(Zt),fn,gt),st.uniformsNeedUpdate=!1),st.isSpriteMaterial&&Ye.setValue(W,"center",rt.center),Ye.setValue(W,"modelViewMatrix",rt.modelViewMatrix),Ye.setValue(W,"normalMatrix",rt.normalMatrix),Ye.setValue(W,"modelMatrix",rt.matrixWorld),st.uniformsGroups!==void 0){const ke=st.uniformsGroups;for(let ia=0,as=ke.length;ia<as;ia++){const Ws=ke[ia];At.update(Ws,Dn),At.bind(Ws,Dn)}}return Dn}function bn(w,Q){w.ambientLightColor.needsUpdate=Q,w.lightProbe.needsUpdate=Q,w.directionalLights.needsUpdate=Q,w.directionalLightShadows.needsUpdate=Q,w.pointLights.needsUpdate=Q,w.pointLightShadows.needsUpdate=Q,w.spotLights.needsUpdate=Q,w.spotLightShadows.needsUpdate=Q,w.rectAreaLights.needsUpdate=Q,w.hemisphereLights.needsUpdate=Q}function vc(w){return w.isMeshLambertMaterial||w.isMeshToonMaterial||w.isMeshPhongMaterial||w.isMeshStandardMaterial||w.isShadowMaterial||w.isShaderMaterial&&w.lights===!0}this.getActiveCubeFace=function(){return F},this.getActiveMipmapLevel=function(){return N},this.getRenderTarget=function(){return V},this.setRenderTargetTextures=function(w,Q,lt){const st=ot.get(w);st.__autoAllocateDepthBuffer=w.resolveDepthBuffer===!1,st.__autoAllocateDepthBuffer===!1&&(st.__useRenderToTexture=!1),ot.get(w.texture).__webglTexture=Q,ot.get(w.depthTexture).__webglTexture=st.__autoAllocateDepthBuffer?void 0:lt,st.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(w,Q){const lt=ot.get(w);lt.__webglFramebuffer=Q,lt.__useDefaultFramebuffer=Q===void 0},this.setRenderTarget=function(w,Q=0,lt=0){V=w,F=Q,N=lt;let st=null,rt=!1,Xt=!1;if(w){const Ht=ot.get(w);if(Ht.__useDefaultFramebuffer!==void 0){E.bindFramebuffer(W.FRAMEBUFFER,Ht.__webglFramebuffer),L.copy(w.viewport),X.copy(w.scissor),_t=w.scissorTest,E.viewport(L),E.scissor(X),E.setScissorTest(_t),nt=-1;return}else if(Ht.__webglFramebuffer===void 0)gt.setupRenderTarget(w);else if(Ht.__hasExternalTextures)gt.rebindTextures(w,ot.get(w.texture).__webglTexture,ot.get(w.depthTexture).__webglTexture);else if(w.depthBuffer){const ue=w.depthTexture;if(Ht.__boundDepthTexture!==ue){if(ue!==null&&ot.has(ue)&&(w.width!==ue.image.width||w.height!==ue.image.height))throw new Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");gt.setupDepthRenderbuffer(w)}}const jt=w.texture;(jt.isData3DTexture||jt.isDataArrayTexture||jt.isCompressedArrayTexture)&&(Xt=!0);const $t=ot.get(w).__webglFramebuffer;w.isWebGLCubeRenderTarget?(Array.isArray($t[Q])?st=$t[Q][lt]:st=$t[Q],rt=!0):w.samples>0&&gt.useMultisampledRTT(w)===!1?st=ot.get(w).__webglMultisampledFramebuffer:Array.isArray($t)?st=$t[lt]:st=$t,L.copy(w.viewport),X.copy(w.scissor),_t=w.scissorTest}else L.copy(ae).multiplyScalar(Et).floor(),X.copy(Pe).multiplyScalar(Et).floor(),_t=me;if(lt!==0&&(st=ft),E.bindFramebuffer(W.FRAMEBUFFER,st)&&E.drawBuffers(w,st),E.viewport(L),E.scissor(X),E.setScissorTest(_t),rt){const Ht=ot.get(w.texture);W.framebufferTexture2D(W.FRAMEBUFFER,W.COLOR_ATTACHMENT0,W.TEXTURE_CUBE_MAP_POSITIVE_X+Q,Ht.__webglTexture,lt)}else if(Xt){const Ht=Q;for(let jt=0;jt<w.textures.length;jt++){const $t=ot.get(w.textures[jt]);W.framebufferTextureLayer(W.FRAMEBUFFER,W.COLOR_ATTACHMENT0+jt,$t.__webglTexture,lt,Ht)}}else if(w!==null&&lt!==0){const Ht=ot.get(w.texture);W.framebufferTexture2D(W.FRAMEBUFFER,W.COLOR_ATTACHMENT0,W.TEXTURE_2D,Ht.__webglTexture,lt)}nt=-1},this.readRenderTargetPixels=function(w,Q,lt,st,rt,Xt,Jt,Ht=0){if(!(w&&w.isWebGLRenderTarget)){Oe("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let jt=ot.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&Jt!==void 0&&(jt=jt[Jt]),jt){E.bindFramebuffer(W.FRAMEBUFFER,jt);try{const $t=w.textures[Ht],ue=$t.format,be=$t.type;if(w.textures.length>1&&W.readBuffer(W.COLOR_ATTACHMENT0+Ht),!B.textureFormatReadable(ue)){Oe("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!B.textureTypeReadable(be)){Oe("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}Q>=0&&Q<=w.width-st&&lt>=0&&lt<=w.height-rt&&W.readPixels(Q,lt,st,rt,It.convert(ue),It.convert(be),Xt)}finally{const $t=V!==null?ot.get(V).__webglFramebuffer:null;E.bindFramebuffer(W.FRAMEBUFFER,$t)}}},this.readRenderTargetPixelsAsync=async function(w,Q,lt,st,rt,Xt,Jt,Ht=0){if(!(w&&w.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let jt=ot.get(w).__webglFramebuffer;if(w.isWebGLCubeRenderTarget&&Jt!==void 0&&(jt=jt[Jt]),jt)if(Q>=0&&Q<=w.width-st&&lt>=0&&lt<=w.height-rt){E.bindFramebuffer(W.FRAMEBUFFER,jt);const $t=w.textures[Ht],ue=$t.format,be=$t.type;if(w.textures.length>1&&W.readBuffer(W.COLOR_ATTACHMENT0+Ht),!B.textureFormatReadable(ue))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!B.textureTypeReadable(be))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");const se=W.createBuffer();W.bindBuffer(W.PIXEL_PACK_BUFFER,se),W.bufferData(W.PIXEL_PACK_BUFFER,Xt.byteLength,W.STREAM_READ),W.readPixels(Q,lt,st,rt,It.convert(ue),It.convert(be),0);const ze=V!==null?ot.get(V).__webglFramebuffer:null;E.bindFramebuffer(W.FRAMEBUFFER,ze);const un=W.fenceSync(W.SYNC_GPU_COMMANDS_COMPLETE,0);return W.flush(),await WE(W,un,4),W.bindBuffer(W.PIXEL_PACK_BUFFER,se),W.getBufferSubData(W.PIXEL_PACK_BUFFER,0,Xt),W.deleteBuffer(se),W.deleteSync(un),Xt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(w,Q=null,lt=0){const st=Math.pow(2,-lt),rt=Math.floor(w.image.width*st),Xt=Math.floor(w.image.height*st),Jt=Q!==null?Q.x:0,Ht=Q!==null?Q.y:0;gt.setTexture2D(w,0),W.copyTexSubImage2D(W.TEXTURE_2D,lt,0,0,Jt,Ht,rt,Xt),E.unbindTexture()},this.copyTextureToTexture=function(w,Q,lt=null,st=null,rt=0,Xt=0){let Jt,Ht,jt,$t,ue,be,se,ze,un;const nn=w.isCompressedTexture?w.mipmaps[Xt]:w.image;if(lt!==null)Jt=lt.max.x-lt.min.x,Ht=lt.max.y-lt.min.y,jt=lt.isBox3?lt.max.z-lt.min.z:1,$t=lt.min.x,ue=lt.min.y,be=lt.isBox3?lt.min.z:0;else{const fn=Math.pow(2,-rt);Jt=Math.floor(nn.width*fn),Ht=Math.floor(nn.height*fn),w.isDataArrayTexture?jt=nn.depth:w.isData3DTexture?jt=Math.floor(nn.depth*fn):jt=1,$t=0,ue=0,be=0}st!==null?(se=st.x,ze=st.y,un=st.z):(se=0,ze=0,un=0);const We=It.convert(Q.format),qe=It.convert(Q.type);let Zt;Q.isData3DTexture?(gt.setTexture3D(Q,0),Zt=W.TEXTURE_3D):Q.isDataArrayTexture||Q.isCompressedArrayTexture?(gt.setTexture2DArray(Q,0),Zt=W.TEXTURE_2D_ARRAY):(gt.setTexture2D(Q,0),Zt=W.TEXTURE_2D),E.activeTexture(W.TEXTURE0),E.pixelStorei(W.UNPACK_FLIP_Y_WEBGL,Q.flipY),E.pixelStorei(W.UNPACK_PREMULTIPLY_ALPHA_WEBGL,Q.premultiplyAlpha),E.pixelStorei(W.UNPACK_ALIGNMENT,Q.unpackAlignment);const Zn=E.getParameter(W.UNPACK_ROW_LENGTH),Re=E.getParameter(W.UNPACK_IMAGE_HEIGHT),Dn=E.getParameter(W.UNPACK_SKIP_PIXELS),_i=E.getParameter(W.UNPACK_SKIP_ROWS),Xi=E.getParameter(W.UNPACK_SKIP_IMAGES);E.pixelStorei(W.UNPACK_ROW_LENGTH,nn.width),E.pixelStorei(W.UNPACK_IMAGE_HEIGHT,nn.height),E.pixelStorei(W.UNPACK_SKIP_PIXELS,$t),E.pixelStorei(W.UNPACK_SKIP_ROWS,ue),E.pixelStorei(W.UNPACK_SKIP_IMAGES,be);const xi=w.isDataArrayTexture||w.isData3DTexture,Ye=Q.isDataArrayTexture||Q.isData3DTexture;if(w.isDepthTexture){const fn=ot.get(w),Wi=ot.get(Q),ke=ot.get(fn.__renderTarget),ia=ot.get(Wi.__renderTarget);E.bindFramebuffer(W.READ_FRAMEBUFFER,ke.__webglFramebuffer),E.bindFramebuffer(W.DRAW_FRAMEBUFFER,ia.__webglFramebuffer);for(let as=0;as<jt;as++)xi&&(W.framebufferTextureLayer(W.READ_FRAMEBUFFER,W.COLOR_ATTACHMENT0,ot.get(w).__webglTexture,rt,be+as),W.framebufferTextureLayer(W.DRAW_FRAMEBUFFER,W.COLOR_ATTACHMENT0,ot.get(Q).__webglTexture,Xt,un+as)),W.blitFramebuffer($t,ue,Jt,Ht,se,ze,Jt,Ht,W.DEPTH_BUFFER_BIT,W.NEAREST);E.bindFramebuffer(W.READ_FRAMEBUFFER,null),E.bindFramebuffer(W.DRAW_FRAMEBUFFER,null)}else if(rt!==0||w.isRenderTargetTexture||ot.has(w)){const fn=ot.get(w),Wi=ot.get(Q);E.bindFramebuffer(W.READ_FRAMEBUFFER,dt),E.bindFramebuffer(W.DRAW_FRAMEBUFFER,J);for(let ke=0;ke<jt;ke++)xi?W.framebufferTextureLayer(W.READ_FRAMEBUFFER,W.COLOR_ATTACHMENT0,fn.__webglTexture,rt,be+ke):W.framebufferTexture2D(W.READ_FRAMEBUFFER,W.COLOR_ATTACHMENT0,W.TEXTURE_2D,fn.__webglTexture,rt),Ye?W.framebufferTextureLayer(W.DRAW_FRAMEBUFFER,W.COLOR_ATTACHMENT0,Wi.__webglTexture,Xt,un+ke):W.framebufferTexture2D(W.DRAW_FRAMEBUFFER,W.COLOR_ATTACHMENT0,W.TEXTURE_2D,Wi.__webglTexture,Xt),rt!==0?W.blitFramebuffer($t,ue,Jt,Ht,se,ze,Jt,Ht,W.COLOR_BUFFER_BIT,W.NEAREST):Ye?W.copyTexSubImage3D(Zt,Xt,se,ze,un+ke,$t,ue,Jt,Ht):W.copyTexSubImage2D(Zt,Xt,se,ze,$t,ue,Jt,Ht);E.bindFramebuffer(W.READ_FRAMEBUFFER,null),E.bindFramebuffer(W.DRAW_FRAMEBUFFER,null)}else Ye?w.isDataTexture||w.isData3DTexture?W.texSubImage3D(Zt,Xt,se,ze,un,Jt,Ht,jt,We,qe,nn.data):Q.isCompressedArrayTexture?W.compressedTexSubImage3D(Zt,Xt,se,ze,un,Jt,Ht,jt,We,nn.data):W.texSubImage3D(Zt,Xt,se,ze,un,Jt,Ht,jt,We,qe,nn):w.isDataTexture?W.texSubImage2D(W.TEXTURE_2D,Xt,se,ze,Jt,Ht,We,qe,nn.data):w.isCompressedTexture?W.compressedTexSubImage2D(W.TEXTURE_2D,Xt,se,ze,nn.width,nn.height,We,nn.data):W.texSubImage2D(W.TEXTURE_2D,Xt,se,ze,Jt,Ht,We,qe,nn);E.pixelStorei(W.UNPACK_ROW_LENGTH,Zn),E.pixelStorei(W.UNPACK_IMAGE_HEIGHT,Re),E.pixelStorei(W.UNPACK_SKIP_PIXELS,Dn),E.pixelStorei(W.UNPACK_SKIP_ROWS,_i),E.pixelStorei(W.UNPACK_SKIP_IMAGES,Xi),Xt===0&&Q.generateMipmaps&&W.generateMipmap(Zt),E.unbindTexture()},this.initRenderTarget=function(w){ot.get(w).__webglFramebuffer===void 0&&gt.setupRenderTarget(w)},this.initTexture=function(w){w.isCubeTexture?gt.setTextureCube(w,0):w.isData3DTexture?gt.setTexture3D(w,0):w.isDataArrayTexture||w.isCompressedArrayTexture?gt.setTexture2DArray(w,0):gt.setTexture2D(w,0),E.unbindTexture()},this.resetState=function(){F=0,N=0,V=null,E.reset(),qt.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return da}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;const e=this.getContext();e.drawingBufferColorSpace=Ie._getDrawingBufferColorSpace(t),e.unpackColorSpace=Ie._getUnpackColorSpace()}}class uR extends Zy{constructor(){super(),this.name="RoomEnvironment",this.position.y=-3.5;const t=new Qa;t.deleteAttribute("uv");const e=new ri({side:ni}),a=new ri,o=new cT(16777215,900,28,2);o.position.set(.418,16.199,.3),this.add(o);const l=new Ge(t,e);l.position.set(-.757,13.219,.717),l.scale.set(31.713,28.305,28.591),this.add(l);const u=new tS(t,a,6),h=new Cn;h.position.set(-10.906,2.009,1.846),h.rotation.set(0,-.195,0),h.scale.set(2.328,7.905,4.651),h.updateMatrix(),u.setMatrixAt(0,h.matrix),h.position.set(-5.607,-.754,-.758),h.rotation.set(0,.994,0),h.scale.set(1.97,1.534,3.955),h.updateMatrix(),u.setMatrixAt(1,h.matrix),h.position.set(6.167,.857,7.803),h.rotation.set(0,.561,0),h.scale.set(3.927,6.285,3.687),h.updateMatrix(),u.setMatrixAt(2,h.matrix),h.position.set(-2.017,.018,6.124),h.rotation.set(0,.333,0),h.scale.set(2.002,4.566,2.064),h.updateMatrix(),u.setMatrixAt(3,h.matrix),h.position.set(2.291,-.756,-2.621),h.rotation.set(0,-.286,0),h.scale.set(1.546,1.552,1.496),h.updateMatrix(),u.setMatrixAt(4,h.matrix),h.position.set(-2.193,-.369,-5.547),h.rotation.set(0,.516,0),h.scale.set(3.875,3.487,2.986),h.updateMatrix(),u.setMatrixAt(5,h.matrix),this.add(u);const d=new Ge(t,Ao(50));d.position.set(-16.116,14.37,8.208),d.scale.set(.1,2.428,2.739),this.add(d);const p=new Ge(t,Ao(50));p.position.set(-16.109,18.021,-8.207),p.scale.set(.1,2.425,2.751),this.add(p);const g=new Ge(t,Ao(17));g.position.set(14.904,12.198,-1.832),g.scale.set(.15,4.265,6.331),this.add(g);const _=new Ge(t,Ao(43));_.position.set(-.462,8.89,14.52),_.scale.set(4.38,5.441,.088),this.add(_);const v=new Ge(t,Ao(20));v.position.set(3.235,11.486,-12.541),v.scale.set(2.5,2,.1),this.add(v);const x=new Ge(t,Ao(100));x.position.set(0,20,0),x.scale.set(1,.1,1),this.add(x)}dispose(){const t=new Set;this.traverse(e=>{e.isMesh&&(t.add(e.geometry),t.add(e.material))});for(const e of t)e.dispose()}}function Ao(s){return new tT({color:0,emissive:16777215,emissiveIntensity:s})}function $l(s,t,e=1){const a=Math.sin(s*127.1+t*311.7+e*74.7)*43758.5453;return a-Math.floor(a)}function My(s){return s*s*(3-2*s)}function fR(s,t,e=1){const a=Math.floor(s),o=Math.floor(t),l=s-a,u=t-o,h=$l(a,o,e),d=$l(a+1,o,e),p=$l(a,o+1,e),g=$l(a+1,o+1,e),_=My(l),v=My(u);return h*(1-_)*(1-v)+d*_*(1-v)+p*(1-_)*v+g*_*v}function hR(s,t,e=5,a=1){let o=0,l=.5,u=1;for(let h=0;h<e;h++)o+=l*fR(s*u,t*u,a+h*13),u*=2.07,l*=.5;return o}function by(s,t,e){return[s[0]+(t[0]-s[0])*e,s[1]+(t[1]-s[1])*e,s[2]+(t[2]-s[2])*e]}const rn=256;function Ey(s,t=1){const e=document.createElement("canvas");e.width=e.height=rn;const a=e.getContext("2d"),o=a.createImageData(rn,rn),l=new Float32Array(rn*rn);for(let v=0;v<rn;v++)for(let x=0;x<rn;x++){const b=v*rn+x;let C=hR(x/rn*s.scale,v/rn*s.scale,s.octaves,t);C=Math.min(1,Math.max(0,(C-.5)*s.contrast+.5)),l[b]=C;const M=s.colors,y=C*(M.length-1),I=Math.min(M.length-2,Math.floor(y));let D=by(M[I],M[I+1],y-I);s.speckle&&$l(x,v,t*3)<s.speckle&&(D=by(D,s.speckleColor??[255,255,255],.55));const A=b*4;o.data[A]=D[0],o.data[A+1]=D[1],o.data[A+2]=D[2],o.data[A+3]=255}a.putImageData(o,0,0);const u=new vf(e);u.colorSpace=Xn,u.wrapS=u.wrapT=Fo,u.anisotropy=8;const h=document.createElement("canvas");h.width=h.height=rn;const d=h.getContext("2d"),p=d.createImageData(rn,rn),g=3;for(let v=0;v<rn;v++)for(let x=0;x<rn;x++){const b=l[v*rn+(x-1+rn)%rn],C=l[v*rn+(x+1)%rn],M=l[(v-1+rn)%rn*rn+x],y=l[(v+1)%rn*rn+x],I=(b-C)*g,D=(M-y)*g,A=Math.hypot(I,D,1),O=(v*rn+x)*4;p.data[O]=(I/A*.5+.5)*255,p.data[O+1]=(D/A*.5+.5)*255,p.data[O+2]=1/A*.5*255+127,p.data[O+3]=255}d.putImageData(p,0,0);const _=new vf(h);return _.wrapS=_.wrapT=Fo,_.anisotropy=8,{map:u,normalMap:_}}const sn=.02,Ty=.01,dR={mountain:.4,hills:.35,forest:.3,goldmine:.25,field:.2,pasture:.18,desert:.15},Mp={forest:{colors:[[6,48,26],[10,92,40],[30,150,62],[120,214,96]],scale:10,octaves:6,contrast:1.9,rough:.92},pasture:{colors:[[34,122,40],[72,178,52],[130,224,74],[198,248,128]],scale:8,octaves:5,contrast:1.6,rough:.9},field:{colors:[[168,104,8],[226,164,18],[255,208,44],[255,244,150]],scale:15,octaves:4,contrast:1.85,rough:.82},hills:{colors:[[108,24,16],[176,52,28],[228,92,46],[252,152,96]],scale:9,octaves:5,contrast:1.75,rough:.93},mountain:{colors:[[38,46,76],[78,92,132],[148,164,200],[238,246,255]],scale:7,octaves:6,contrast:2,rough:.65},goldmine:{colors:[[74,44,8],[156,102,14],[238,176,30],[255,236,140]],scale:9,octaves:6,contrast:1.95,rough:.42},desert:{colors:[[206,142,62],[242,190,104],[255,224,156],[255,248,214]],scale:11,octaves:5,contrast:1.5,speckle:.06,speckleColor:[255,252,232],rough:.97}};function pR(s){let t=0,e=0;for(const a of s)t+=a[0],e+=a[1];return[t/s.length,e/s.length]}function Ay(s,t){const[e,a]=pR(s);return s.map(([o,l])=>{const u=o-e,h=l-a,d=Math.hypot(u,h)||1;return[o+u/d*t,l+h/d*t]})}function bp(s){const t=new cS;return s.forEach((e,a)=>a?t.lineTo(e[0]*sn,e[1]*sn):t.moveTo(e[0]*sn,e[1]*sn)),t.closePath(),t}function mR(s,t,e){let a=!1;for(let o=0,l=s.length-1;o<s.length;l=o++){const[u,h]=s[o],[d,p]=s[l];h>e!=p>e&&t<(d-u)*(e-h)/(p-h)+u&&(a=!a)}return a}const Do=new Image;let Mm=!1;Do.onload=()=>{Mm=!0};Do.src=Rm;function gR(s){const e=document.createElement("canvas");e.width=e.height=192;const a=e.getContext("2d"),o=cf[s].res,l=new vf(e);l.colorSpace=Xn,l.anisotropy=8;const u=()=>{a.clearRect(0,0,192,192),a.beginPath(),a.arc(192/2,192/2,192/2-6,0,7);const h=a.createLinearGradient(0,0,0,192);if(h.addColorStop(0,"rgba(28,22,14,0.95)"),h.addColorStop(1,"rgba(10,8,5,0.95)"),a.fillStyle=h,a.fill(),a.lineWidth=8,a.strokeStyle=o?jn[o].ring:"#c9c9c9",a.stroke(),o&&Mm){const d=Do.naturalWidth/ic,p=Do.naturalHeight,g=192*.62;a.drawImage(Do,Cm[o]*d,0,d,p,(192-g)/2,(192-g)/2,g,g)}else o||(a.font=`${192*.5}px "Apple Color Emoji","Segoe UI Emoji",serif`,a.textAlign="center",a.textBaseline="middle",a.fillText("☠️",192/2,192/2+4));l.needsUpdate=!0};return u(),o&&!Mm&&Do.addEventListener("load",u,{once:!0}),l}function vR(){const t=document.createElement("canvas");t.width=t.height=128;const e=t.getContext("2d");e.font=`${128*.8}px "Apple Color Emoji","Segoe UI Emoji",serif`,e.textAlign="center",e.textBaseline="middle",e.fillText("🚫",128/2,128/2);const a=new vf(t);return a.colorSpace=Xn,a}class _R{canvas;map;renderer;scene=new Zy;camera;raycaster=new dT;zoom=1;cx=0;cy=0;hover=null;legalVerts=new Set;legalEdges=new Set;mode=null;onPick=()=>{};target=new q;dist=26;yaw=-.5;pitch=.92;tTarget=new q;tDist=26;tYaw=-.5;tPitch=.92;tileMeshes=[];tileHeight=[];dynamic=new Xa;markers=new Xa;banditSprites=[];oceanUniforms={uTime:{value:0}};ringUniforms={uTime:{value:0}};shoreRings=new Xa;sig="";markerSig="";leftPanel=278;rightPanel=480;constructor(t,e){this.canvas=t,this.map=e,this.renderer=new cR({canvas:t,antialias:!0,powerPreference:"high-performance"}),this.renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1)),this.renderer.shadowMap.enabled=!0,this.renderer.shadowMap.type=Uy,this.renderer.toneMapping=Bm,this.renderer.toneMappingExposure=1,this.renderer.outputColorSpace=Xn,this.camera=new Ci(42,1,.5,900),this.scene.fog=new Zm(749224,.0065);const a=new xm(this.renderer);this.scene.environment=a.fromScene(new uR,.05).texture,this.scene.environmentIntensity=.35,this.buildSky(),this.buildLights(),this.buildOcean(),this.buildLand(),this.buildShoreRings(),this.scene.add(this.dynamic),this.scene.add(this.markers),this.resize(),window.addEventListener("resize",()=>this.resize()),this.bindInput(),this.fit()}buildSky(){const t=new nc(500,32,16),e=new Ui({side:ni,depthWrite:!1,uniforms:{top:{value:new pe("#0a4fb5")},mid:{value:new pe("#63c8f5")},bot:{value:new pe("#ffdca6")}},vertexShader:"varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",fragmentShader:`
        varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){
          float h = normalize(vP).y;
          vec3 c = mix(bot, mid, smoothstep(-0.15, 0.18, h));
          c = mix(c, top, smoothstep(0.15, 0.75, h));
          gl_FragColor = vec4(c, 1.0);
        }`});this.scene.add(new Ge(t,e))}buildLights(){this.scene.add(new oT(10474751,1329231,.3));const t=new Kx(16767392,3.4);t.position.set(16,26,12),t.castShadow=!0,t.shadow.mapSize.set(2048,2048),t.shadow.bias=-9e-4,t.shadow.normalBias=.03;const e=t.shadow.camera;e.left=-22,e.right=22,e.top=22,e.bottom=-22,e.near=1,e.far=90,this.scene.add(t);const a=new Kx(4892415,.38);a.position.set(-14,9,-12),this.scene.add(a)}buildOcean(){const t=new Vo(900,900,900,900),e=new Ui({uniforms:{uTime:this.oceanUniforms.uTime,uSunDir:{value:new q(16,16,16).normalize()},uShore:{value:new pe("#7fe3e8")},uShallow:{value:new pe("#33b4dd")},uMid:{value:new pe("#1d78bf")},uDeep:{value:new pe("#12468c")}},vertexShader:`
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNrm;

        // three long, slow swells — large wavelengths only, so no visible tiling
        float swell(vec2 p, out vec2 grad){
          float h = 0.0; grad = vec2(0.0);
          vec3 w[3];
          w[0] = vec3(3.01);
          w[1] = vec3( 3.01);
          w[2] = vec3( 3.01);
          float amp[3];
          amp[0] = 0.0; amp[1] = 0.0; amp[2] = 0.0;
          for(int i=0;i<3;i++){
            vec2 d = normalize(w[i].xy);
            float k = 6.28318 / w[i].z;
            float ph = dot(d,p)*k + uTime * sqrt(9.8/k) * 0.30;
            h += amp[i]*sin(ph);
            grad += d*(k*amp[i]*cos(ph));
          }
          return h;
        }

        void main(){
          vec3 wp = (modelMatrix * vec4(position,1.0)).xyz;
          vec2 grd; float hh = swell(wp.xz, grd);
          vNrm = normalize(vec3(-grd.x, 1.0, -grd.y));
          vec3 transformed = position;
          transformed.z += hh;
          vWorld = wp + vec3(0.0, hh, 0.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        }`,fragmentShader:`
        uniform float uTime;
        uniform vec3 uSunDir, uShore, uShallow, uMid, uDeep;
        varying vec3 vWorld;
        varying vec3 vNrm;

        void main(){
          float d = length(vWorld.xz);

          // soft depth gradient — the main source of colour
          vec3 col = mix(uShore, uShallow, smoothstep(2.5, 8.0, d));
          col = mix(col, uMid,  smoothstep(8.0, 22.0, d));
          col = mix(col, uDeep, smoothstep(22.0, 70.0, d));

          vec3 N = normalize(vNrm);
          vec3 V = normalize(cameraPosition - vWorld);

          // gentle lambert-ish shading off the swell normals: gives the water
          // form without any speckle
          float lambert = 0.5 + 0.5 * dot(N, uSunDir);
          col *= 0.88 + lambert * 0.24;

          // wide, soft sun sheen (low exponent = broad highlight, no glitter)
          vec3 H = normalize(uSunDir + V);
          float sheen = pow(max(dot(N, H), 0.0), 22.0);
          col += vec3(1.0, 0.97, 0.90) * sheen * 0.22;

          // slow contour ripples radiating from the island — the illustrated
          // "hand-drawn water lines" look
          float rings = sin(d * 2.6 - uTime * 0.55);
          float lines = smoothstep(0.86, 1.0, rings) * (1.0 - smoothstep(6.0, 30.0, d));
          col = mix(col, col + vec3(0.16, 0.22, 0.20), lines * 0.55);

          // clean shore band, no noise
          float shore = 1.0 - smoothstep(1.6, 3.4, d);
          col = mix(col, vec3(0.90, 0.99, 1.0), shore * 0.55);

          // horizon lift so the far ocean meets the sky softly
          col = mix(col, vec3(0.36, 0.66, 0.86), smoothstep(90.0, 260.0, d) * 0.75);

          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`}),a=new Ge(t,e);a.rotation.x=-Math.PI/2,a.position.y=Ty,this.scene.add(a)}buildShoreRings(){const t=this.map.bounds,e=(t.minX+t.maxX)/2,a=(t.minY+t.maxY)/2,o=120,l=new Array(o).fill(0),u=new Array(o).fill(null);for(const v of this.map.tiles)for(const x of lx(this.map,v)){const b=Math.atan2(x[1]-a,x[0]-e),C=Math.floor((b+Math.PI)/(2*Math.PI)*o)%o,M=Math.hypot(x[0]-e,x[1]-a);M>l[C]&&(l[C]=M,u[C]=x)}for(let v=0;v<o;v++){if(u[v])continue;let x=1;for(;!u[(v+x)%o]&&x<o;)x++;let b=1;for(;!u[(v-b+o)%o]&&b<o;)b++;const C=u[(v+x)%o],M=u[(v-b+o)%o];u[v]=C&&M?[(C[0]+M[0])/2,(C[1]+M[1])/2]:[e,a]}let h=u.map(v=>[v[0],v[1]]);const d=4;for(let v=0;v<d;v++){const x=new Array(o);for(let b=0;b<o;b++){const C=h[(b-1+o)%o],M=h[b],y=h[(b+1)%o];x[b]=[(C[0]+2*M[0]+y[0])/4,(C[1]+2*M[1]+y[1])/4]}h=x}const p=(v,x)=>{const b=[],C=[],M=[],y=[];for(let A=0;A<=o;A++){const O=h[A%o],U=O[0]-e,z=O[1]-a,T=Math.hypot(U,z)||1,P=U/T,k=z/T;y.push({x:O[0]+P*v,y:O[1]+k*v,nx:P,ny:k})}const I=(A,O,U,z,T)=>{b.push(A*sn,Ty+.01,-O*sn),C.push(U*sn,0,-z*sn),M.push(T)};for(let A=0;A<o;A++){const O=y[A],U=y[A+1];I(e,a,0,0,0),I(O.x,O.y,O.nx,O.ny,1),I(U.x,U.y,U.nx,U.ny,1)}const D=new li;return D.setAttribute("position",new gn(b,3)),D.setAttribute("onrm",new gn(C,3)),D.setAttribute("across",new gn(M,1)),D},g=4,_=Ro*.55;for(let v=0;v<g;v++){const x=new Ui({transparent:!0,depthWrite:!1,side:$i,uniforms:{uTime:this.ringUniforms.uTime,uPhase:{value:v/g},uTravel:{value:_},uColor:{value:new pe("#e6fbff")}},vertexShader:`
          uniform float uTime; uniform float uPhase; uniform float uTravel;
          attribute vec3 onrm;
          attribute float across;
          varying float vLife;
          varying float vAcross;
          void main(){
            vLife = fract(uTime * 0.16 + uPhase);
            vAcross = across;
            vec3 pos = position + onrm * (vLife * uTravel);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
          }`,fragmentShader:`
          uniform vec3 uColor; varying float vLife; varying float vAcross;
          void main(){
            // fully solid across the inner span, feather only the outermost edge
            float edge = 1.0 - smoothstep(0.80, 1.0, vAcross);
            float life = smoothstep(0.0, 0.15, vLife) * (1.0 - smoothstep(0.5, 1.0, vLife));
            gl_FragColor = vec4(uColor, edge * life * 0.45);
          }`}),b=new Ge(p(Ro*.09),x);b.renderOrder=4,this.shoreRings.add(b)}this.scene.add(this.shoreRings)}buildLand(){const t=this.map,e=Ey({colors:[[206,184,142],[230,214,180],[244,234,212],[253,250,240]],scale:22,octaves:5,contrast:1.1,speckle:.04,speckleColor:[255,255,250]},21);e.map.repeat.set(4.5,4.5),e.normalMap.repeat.set(4.5,4.5);const a=new ri({map:e.map,normalMap:e.normalMap,normalScale:new Ut(.6,.6),roughness:1,metalness:0,color:16771522}),o=new ri({color:11568472,roughness:.95}),l=new rT,u={forest:10152079,pasture:13170074,field:16767344,hills:16751210,mountain:14082805,goldmine:16767370,desert:16773316},h={forest:.2,pasture:.2,field:.2,hills:.2,mountain:.2,goldmine:.2,desert:.2},d={};Object.keys(Mp).forEach((y,I)=>{const{normalMap:D}=Ey(Mp[y],I*11+5);D.repeat.set(h[y],h[y]);const A=new ri({color:new pe(u[y]),normalMap:D,normalScale:new Ut(1.1,1.1),roughness:Mp[y].rough,metalness:y==="goldmine"?.4:.02,envMapIntensity:.3}),O=eE[y];O&&l.load(O,U=>{U.colorSpace=Xn,U.wrapS=U.wrapT=Fo,U.anisotropy=8,U.repeat.set(h[y],h[y]),A.map=U,A.needsUpdate=!0}),d[y]=A});const p=[],g=[],_=[],v=new Cn;t.tiles.forEach(y=>{const I=lx(t,y),D=dR[y.type];this.tileHeight[y.i]=D;const A=new ec(bp(I),{depth:D,bevelEnabled:!0,bevelThickness:.05,bevelSize:.05,bevelSegments:2});A.rotateX(-Math.PI/2),A.computeVertexNormals();const O=new Ge(A,[d[y.type],o]);O.castShadow=!0,O.receiveShadow=!0,O.userData={kind:"tile",id:y.i},this.scene.add(O),this.tileMeshes.push(O);const U=new Ge(new ec(bp(Ay(I,16)),{depth:.2,bevelEnabled:!1}),a);U.geometry.rotateX(-Math.PI/2),U.position.y=-.02,U.receiveShadow=!0,this.scene.add(U);const z=new Ge(new ec(bp(Ay(I,130)),{depth:.05,bevelEnabled:!1}),a);z.geometry.rotateX(-Math.PI/2),z.position.y=-.45,this.scene.add(z);const T=new Cx(new mm({map:gR(y.type),depthTest:!0}));T.scale.setScalar(.9),T.position.set(y.x*sn,D+.62,-y.y*sn),this.scene.add(T);const P=new Cx(new mm({map:vR(),depthTest:!1}));P.scale.setScalar(.85),P.position.set(y.x*sn,D+1.35,-y.y*sn),P.visible=!1,P.userData.tile=y.i,this.scene.add(P),this.banditSprites[y.i]=P;const k=y.type==="forest"?16:y.type==="mountain"?9:y.type==="pasture"?8:0;let H=0,K=0;for(;H<k&&K++<k*12;){const ft=y.x+(Math.random()-.5)*Ro*1.4,dt=y.y+(Math.random()-.5)*Ro*1.4;if(!mR(I,ft,dt))continue;H++;const J=.75+Math.random()*.6;v.position.set(ft*sn,D,-dt*sn),v.rotation.set(0,Math.random()*6.28,0),v.scale.setScalar(J),v.updateMatrix();const F=v.matrix.clone();y.type==="forest"?p.push(F):y.type==="mountain"?g.push(F):_.push(F)}});const x=(y,I,D)=>{if(!D.length)return;const A=new tS(y,I,D.length);D.forEach((O,U)=>A.setMatrixAt(U,O)),A.castShadow=!0,A.receiveShadow=!0,this.scene.add(A)},b=new _f(.16,.55,8);b.translate(0,.3,0),x(b,new ri({color:1866292,roughness:.85,flatShading:!0,emissive:667154,emissiveIntensity:.4}),p);const C=new _f(.3,.62,5);C.translate(0,.3,0),x(C,new ri({color:12175069,roughness:.6,metalness:.18,flatShading:!0}),g);const M=new nc(.1,10,8);M.translate(0,.11,0),x(M,new ri({color:15986662,roughness:1}),_)}vertY(t){const e=this.map.verts[t];let a=.3;for(const o of e.tiles)a=Math.max(a,this.tileHeight[o]??.4);return a}edgeY(t){let e=.3;for(const a of t.tiles)e=Math.max(e,this.tileHeight[a]??.4);return e}edgePath(t,e){const a=this.map.verts[t.a],o=this.map.verts[t.b],l=[[a.x,a.y],...t.wob,[o.x,o.y]];return new iS(l.map(u=>new q(u[0]*sn,e,-u[1]*sn)))}rebuildDynamic(t){const e=this.map.edges.map(a=>a.owner).join(",")+"|"+this.map.verts.map(a=>a.building?a.building[0]+a.owner:"").join(",");if(e!==this.sig){this.sig=e,this.dynamic.clear();for(const a of this.map.edges){if(a.owner<0)continue;const o=this.edgeY(a)+.05,l=this.edgePath(a,o),u=new Ge(new jm(l,18,.075,7,!1),new ri({color:new pe(t[a.owner].color),roughness:.45,metalness:.35,emissive:new pe(t[a.owner].color).multiplyScalar(.18)}));u.castShadow=!0,this.dynamic.add(u);const h=new Xa;for(let d=0;d<=6;d++){const p=l.getPointAt(d/6),g=l.getTangentAt(d/6),_=new Ge(new Qa(.05,.04,.26),new ri({color:4863778,roughness:1}));_.position.copy(p).setY(o-.03),_.rotation.y=Math.atan2(g.x,g.z),h.add(_)}this.dynamic.add(h)}for(const a of this.map.verts){if(!a.building)continue;const o=new pe(t[a.owner].color),l=this.vertY(a.i),u=new Xa;u.position.set(a.x*sn,l,-a.y*sn);const h=(d,p,g,_,v)=>{const x=new Ge(new Qa(d,p,g),new ri({color:_,roughness:.5,metalness:.25}));return x.position.y=v+p/2,x.castShadow=!0,x.receiveShadow=!0,x};if(a.building==="capital"){u.add(h(.62,.42,.62,o,0)),u.add(h(.2,.66,.2,o.clone().multiplyScalar(.75),.42));const d=new Ge(new Vo(.3,.18),new ri({color:16766834,side:$i,roughness:.6}));d.position.set(.16,1,0),u.add(d)}else if(a.building==="city"){u.add(h(.6,.5,.42,o,0));for(let d=0;d<3;d++){const p=h(.1,.44,.1,o.clone().multiplyScalar(.6),.5);p.position.x=-.18+d*.18,u.add(p);const g=new Ge(new nc(.08,8,6),new ri({color:14672872,transparent:!0,opacity:.5,roughness:1}));g.position.set(-.18+d*.18,1.02,0),u.add(g)}}else{u.add(h(.42,.32,.32,o,0));const d=h(.08,.3,.08,o.clone().multiplyScalar(.6),.32);u.add(d)}this.dynamic.add(u)}}}rebuildMarkers(){const t=`${this.mode}|${[...this.legalVerts].join(",")}|${[...this.legalEdges].join(",")}`;if(t===this.markerSig)return;this.markerSig=t,this.markers.clear();const e=new ri({color:16769658,emissive:16760371,emissiveIntensity:.9,roughness:.4,transparent:!0,opacity:.92}),a=new ri({color:16751164,emissive:16742928,emissiveIntensity:.9,roughness:.4});this.legalVerts.forEach(l=>{const u=this.map.verts[l],h=new Ge(new uc(.22,.22,.06,20),e);h.position.set(u.x*sn,this.vertY(l)+.16,-u.y*sn),h.userData={marker:"vert",id:l},this.markers.add(h);const d=new Ge(new uc(.05,.05,.9,8),new Km({color:16769658,transparent:!0,opacity:.28}));d.position.set(u.x*sn,this.vertY(l)+.6,-u.y*sn),this.markers.add(d)});const o=this.mode==="toll";this.legalEdges.forEach(l=>{const u=this.map.edges[l],h=this.edgeY(u)+(o?.16:.07),d=this.edgePath(u,h);for(let p=0;p<7;p++){const g=d.getPointAt((p+.5)/7),_=d.getTangentAt((p+.5)/7),v=new Ge(new Qa(.1,.05,.24),o?a:e);v.position.copy(g),v.rotation.y=Math.atan2(_.x,_.z),v.userData={marker:"edge",id:l},this.markers.add(v)}})}resize(){const t=window.innerWidth,e=window.innerHeight;this.renderer.setSize(t,e,!1),this.camera.aspect=t/e,this.leftPanel=t>1200?278:0,this.rightPanel=t>1200?480:0;const a=(this.leftPanel-this.rightPanel)/2;this.camera.setViewOffset(t,e,-a,0,t,e),this.camera.updateProjectionMatrix()}fit(){const t=this.map.bounds;this.tTarget.set((t.minX+t.maxX)/2*sn,.4,-((t.minY+t.maxY)/2)*sn);const e=Math.max(t.maxX-t.minX,t.maxY-t.minY)*sn;this.tDist=Math.max(9,e*1.15),this.tYaw=-.45,this.tPitch=.95}bindInput(){const t=this.canvas;let e="none",a=0,o=0,l=0,u=0,h=!1,d=0,p=-1;const g=new Map;let _=0;t.style.touchAction="none",t.addEventListener("contextmenu",x=>x.preventDefault()),t.addEventListener("pointerdown",x=>{if(g.set(x.pointerId,{x:x.clientX,y:x.clientY}),h=x.pointerType!=="mouse",h&&g.size===2){const[b,C]=[...g.values()];_=Math.hypot(b.x-C.x,b.y-C.y),e="orbit";return}if(!(g.size>1)){d=performance.now(),p=x.pointerId,a=l=x.clientX,o=u=x.clientY,e=x.button===0&&!x.shiftKey?"pan":"orbit";try{t.setPointerCapture(x.pointerId)}catch{}}}),t.addEventListener("pointermove",x=>{if(g.has(x.pointerId)&&g.set(x.pointerId,{x:x.clientX,y:x.clientY}),h&&g.size===2){const[M,y]=[...g.values()],I=Math.hypot(M.x-y.x,M.y-y.y);_>0&&(this.tDist=Math.max(3.2,Math.min(70,this.tDist*(_/I)))),_=I;return}if(e==="none"||x.pointerId!==p){!h&&e==="none"&&(this.hover=this.pickAt(x.clientX,x.clientY));return}if(!h&&x.buttons===0){e="none";return}const b=x.clientX-a,C=x.clientY-o;if(a=x.clientX,o=x.clientY,e==="orbit")this.tYaw-=b*.008,this.tPitch=Math.max(.22,Math.min(1.42,this.tPitch-C*.006));else{const M=this.tDist*(h?.0042:.0034),y=new q(Math.sin(this.tYaw),0,Math.cos(this.tYaw)),I=new q(y.z,0,-y.x);this.tTarget.addScaledVector(I,-b*M),this.tTarget.addScaledVector(y,-C*M)}});const v=x=>{if(g.delete(x.pointerId),g.size<2&&(_=0),x.pointerId!==p){g.size||(e="none");return}const b=Math.abs(x.clientX-l)+Math.abs(x.clientY-u),C=performance.now()-d;e==="pan"&&b<(h?18:6)&&C<700&&this.onPick(this.pickAt(x.clientX,x.clientY)),e="none",p=-1};t.addEventListener("pointerup",v),t.addEventListener("pointercancel",x=>{g.delete(x.pointerId),x.pointerId===p&&(e="none",p=-1),g.size||(_=0)}),window.addEventListener("pointerup",x=>{x.pointerId===p&&(e="none",p=-1,g.delete(x.pointerId))}),t.addEventListener("wheel",x=>{x.preventDefault(),this.tDist=Math.max(3.2,Math.min(70,this.tDist*(x.deltaY<0?.9:1.111)))},{passive:!1})}project(t,e,a){const o=new q(t*sn,a,-e*sn).project(this.camera);return[(o.x+1)/2*window.innerWidth,(1-o.y)/2*window.innerHeight]}pickAt(t,e){const a=window.matchMedia("(pointer: coarse)").matches;if(this.mode==="settlement"||this.mode==="city"||this.mode==="capital"){let l=-1,u=a?56:34;return this.map.verts.forEach(h=>{if(!h.buildable)return;const[d,p]=this.project(h.x,h.y,this.vertY(h.i)+.2),g=Math.hypot(d-t,p-e);g<u&&(u=g,l=h.i)}),l>=0?{kind:"vertex",id:l}:null}if(this.mode==="road"||this.mode==="toll"){let l=-1,u=a?60:38;return this.map.edges.forEach(h=>{if(!h.rail)return;const[d,p]=this.project(h.x,h.y,this.edgeY(h)+.1),g=Math.hypot(d-t,p-e);g<u&&(u=g,l=h.i)}),l>=0?{kind:"edge",id:l}:null}this.raycaster.setFromCamera(new Ut(t/window.innerWidth*2-1,-(e/window.innerHeight)*2+1),this.camera);const o=this.raycaster.intersectObjects(this.tileMeshes,!1)[0];return o?{kind:"tile",id:o.object.userData.id}:null}draw(t,e){const a=t/1e3;this.oceanUniforms.uTime.value=a,this.ringUniforms.uTime.value=a,this.rebuildDynamic(e),this.rebuildMarkers(),this.map.tiles.forEach(h=>{const d=this.banditSprites[h.i];if(!d)return;const p=h.banditUntil>t;d.visible=p,p&&(d.position.y=(this.tileHeight[h.i]??.4)+1.3+Math.sin(a*3)*.06)});const o=this.hover;this.markers.children.forEach(h=>{const d=h.userData,p=1+Math.sin(a*4+(h.position.x+h.position.z)*2)*.12;let g=p;d?.marker==="vert"&&o?.kind==="vertex"&&o.id===d.id&&(g=p*1.7),d?.marker==="edge"&&o?.kind==="edge"&&o.id===d.id&&(g=p*1.5),h.scale.setScalar(g)});const l=.14;this.target.lerp(this.tTarget,l),this.dist+=(this.tDist-this.dist)*l,this.yaw+=(this.tYaw-this.yaw)*l,this.pitch+=(this.tPitch-this.pitch)*l,this.zoom=12/this.dist;const u=new q(Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),Math.cos(this.yaw)*Math.cos(this.pitch)).multiplyScalar(this.dist).add(this.target);this.camera.position.copy(u),this.camera.lookAt(this.target),this.renderer.render(this.scene,this.camera)}}const Os=s=>new Promise(t=>setTimeout(t,s));class ig{grid=[];seq=1;busy=!1;pool=["wood","brick","sheep","wheat","ore"];fogUntil=0;blockUntil=0;comboCount=0;static COMBOS_PER_GOLD=2;onHarvest=()=>{};onGold=()=>{};onFx=()=>{};onChange=()=>{};onPopup=()=>{};onCombo=()=>{};constructor(){this.initFill()}newGem(t,e,a,o=!1){return{id:this.seq++,res:t,tier:0,special:null,hard:0,block:!1,r:e,c:a,isNew:o}}randRes(){return Ya(this.pool.length?this.pool:Vi.slice(0,4))}initFill(){this.grid=[];for(let t=0;t<In;t++){this.grid[t]=[];for(let e=0;e<kn;e++){let a=this.randRes();for(let o=0;o<25&&(e>=2&&this.grid[t][e-1]?.res===a&&this.grid[t][e-2]?.res===a||t>=2&&this.grid[t-1][e]?.res===a&&this.grid[t-2][e]?.res===a);o++)a=this.randRes();this.grid[t][e]=this.newGem(a,t,e)}}}gems(){const t=[];for(let e=0;e<In;e++)for(let a=0;a<kn;a++){const o=this.grid[e][a];o&&t.push(o)}return t}matchable(t){return!!t&&!t.block&&t.special!=="bomb"}isWild(t){return!!t&&t.res==="gold"&&!t.block&&t.special!=="bomb"}lineRuns(t){const e=[],a=t.length;let o=0;for(;o<a;){const l=t[o];if(!this.matchable(l)){o++;continue}let u=this.isWild(l)?null:l.res;const h=[l];let d=o+1;for(;d<a;){const v=t[d];if(!this.matchable(v))break;if(this.isWild(v)){h.push(v),d++;continue}if(u===null){u=v.res,h.push(v),d++;continue}if(v.res===u){h.push(v),d++;continue}break}const p=h.length>=3&&u!==null;p&&e.push(h);let g=0,_=h.length-1;for(;_>=0&&this.isWild(h[_]);)g++,_--;o=p?Math.max(o+1,d-g):o+1}return e}findGroups(){const t=[];for(let e=0;e<In;e++)t.push(...this.lineRuns(this.grid[e]));for(let e=0;e<kn;e++){const a=[];for(let o=0;o<In;o++)a.push(this.grid[o][e]);t.push(...this.lineRuns(a))}return t}resolve(t,e){const a=new Set,o=new Set,l=[],u=[];for(const d of t){const p=d.length,g=(d.find(b=>b.res!=="gold")??d[0]).res,_=d.some(b=>b.tier>0),v=p>=4?2:1;for(const b of d){if(b.hard>0){o.add(b.id);continue}if(a.add(b.id),b.tier>0){const C=b.tier*v;this.onHarvest(b.res,C),e[b.res]=(e[b.res]??0)+C}}const x=d[Math.floor(p/2)];p===4&&!_&&l.push({r:x.r,c:x.c,res:g,tier:1}),p>=5&&(u.push({r:x.r,c:x.c,res:g}),_||l.push({r:d[0].r,c:d[0].c,res:g,tier:2}))}const h=[];for(let d=0;d<In;d++)for(let p=0;p<kn;p++){const g=this.grid[d][p];g&&(a.has(g.id)?(g.dead=!0,this.onFx("pop",d,p),this.grid[d][p]=null,h.push({r:d,c:p})):o.has(g.id)&&(g.hard=g.hard-1,this.onFx("crack",d,p)))}for(const{r:d,c:p}of h)for(const[g,_]of[[-1,0],[1,0],[0,-1],[0,1]]){const v=d+g,x=p+_;if(v<0||v>=In||x<0||x>=kn)continue;const b=this.grid[v][x];b&&b.block&&(b.block=!1,this.onFx("crack",v,x))}for(const d of l){const p=this.newGem(d.res,d.r,d.c);p.tier=d.tier,this.grid[d.r][d.c]=p,this.onFx("up",d.r,d.c)}for(const d of u){const p=this.newGem(d.res,d.r,d.c);p.special="bomb",this.grid[d.r][d.c]=p,this.onFx("boom",d.r,d.c)}}gravity(){for(let t=0;t<kn;t++){const e=[];for(let o=In-1;o>=0;o--){const l=this.grid[o][t];l&&e.push(l),this.grid[o][t]=null}let a=In-1;for(const o of e)o.r=a,o.c=t,this.grid[a][t]=o,a--;for(;a>=0;a--){const o=this.newGem(this.randRes(),a,t,!0);this.grid[a][t]=o}}}async settle(t=0){this.busy=!0;let e=t;const a={};let o=t;for(;;){const l=this.findGroups();if(!l.length)break;if(e++,o=Math.max(o,e),this.resolve(l,a),this.onChange(),await Os(190),this.gravity(),this.onChange(),await Os(210),e>=2){const u=l[0][0];this.onFx("chain",u.r,u.c,`CHAIN x${e}`)}}if(Object.keys(a).length){const l=o>1?`COMBO x${o}`:"";this.onPopup(a,l)}o>=2&&this.registerCombo(),this.hasMove()||await this.reshuffle(),this.busy=!1}async trySwap(t,e,a,o,l){if(this.busy||this.fogUntil>l||Math.abs(t-a)+Math.abs(e-o)!==1)return;const u=this.grid[t][e],h=this.grid[a][o];if(!u||!h||u.block||h.block)return;if(this.busy=!0,this.grid[t][e]=h,this.grid[a][o]=u,u.r=a,u.c=o,h.r=t,h.c=e,this.onChange(),u.special==="bomb"||h.special==="bomb"){await Os(160);const p=u.special==="bomb"?u:h,g=u.special==="bomb"?h:u;await this.detonate(p,g.res);return}if(await Os(160),!this.findGroups().length){this.grid[t][e]=u,this.grid[a][o]=h,u.r=t,u.c=e,h.r=a,h.c=o,this.onFx("bad",t,e),this.onChange(),await Os(160),this.busy=!1;return}await this.settle(0)}async detonate(t,e){this.busy=!0;const a={};t.dead=!0,this.grid[t.r][t.c]=null,this.onFx("boom",t.r,t.c);for(let o=0;o<In;o++)for(let l=0;l<kn;l++){const u=this.grid[o][l];if(!(!u||u.block||u.res!==e)){if(u.hard>0){u.hard=u.hard-1,this.onFx("crack",o,l);continue}u.tier>0&&(this.onHarvest(u.res,u.tier),a[u.res]=(a[u.res]??0)+u.tier),u.dead=!0,this.grid[o][l]=null,this.onFx("pop",o,l)}}Object.keys(a).length&&this.onPopup(a,"COLOUR PURGE"),this.onChange(),await Os(260),this.gravity(),this.onChange(),await Os(230),await this.settle(2)}spawnTokens(t){for(const e of Object.keys(t)){if(e==="gold")continue;const a=t[e],o=[];for(let l=0;l<In;l++)for(let u=0;u<kn;u++){const h=this.grid[l][u];h&&h.res===e&&h.tier===0&&!h.special&&!h.block&&h.hard===0&&o.push(h)}if(o.length){const l=Ya(o);l.tier=a,this.onFx("up",l.r,l.c)}}if(t.gold!==void 0){const e=t.gold>=2?2:1;this.spawnGold(e)}this.onChange()}registerCombo(){this.comboCount++;const t=ig.COMBOS_PER_GOLD;this.comboCount>=t?(this.comboCount-=t,this.spawnGold(1),this.onCombo(this.comboCount,t,!0),this.onChange()):this.onCombo(this.comboCount,t,!1)}spawnGold(t){const e=this.gems().filter(o=>o.res!=="gold"&&o.tier===0&&!o.special&&!o.block&&o.hard===0);if(!e.length)return;const a=Ya(e);a.res="gold",a.tier=t,this.onFx("up",a.r,a.c)}harden(t=7){const e=this.gems().filter(a=>!a.block&&!a.special);for(const a of Bd(e).slice(0,t))a.hard=2,this.onFx("crack",a.r,a.c);this.onChange()}dropBlocks(t=4,e=3e4,a=performance.now()){const o=Bd(Array.from({length:kn},(l,u)=>u)).slice(0,t);for(const l of o){const u=2+Bo(In-3),h=this.newGem(this.randRes(),u,l);h.block=!0,this.grid[u][l]=h,this.onFx("boom",u,l)}this.blockUntil=a+e,this.onChange()}fog(t=3e4,e=performance.now()){this.fogUntil=e+t}smashBlocks(){let t=0,e=!1;this.blockUntil=0;for(let a=0;a<In;a++)for(let o=0;o<kn;o++){const l=this.grid[a][o];l&&(l.block?(l.dead=!0,this.grid[a][o]=null,this.onFx("boom",a,o),t++,e=!0):l.hard>0&&(l.hard=0,this.onFx("crack",a,o),t++))}return e&&this.gravity(),t&&this.onChange(),t}tickEffects(t){if(!this.busy){if(this.blockUntil&&t>this.blockUntil){this.blockUntil=0;let e=!1;for(let a=0;a<In;a++)for(let o=0;o<kn;o++){const l=this.grid[a][o];l?.block&&(l.dead=!0,this.grid[a][o]=null,e=!0)}e&&(this.gravity(),this.onChange())}!this.busy&&!this.hasMove()&&this.reshuffle()}}hasMove(){const t=(e,a,o,l)=>{const u=this.grid[e][a],h=this.grid[o][l];if(!u||!h||u.block||h.block||u.special==="bomb"||h.special==="bomb")return!1;this.grid[e][a]=h,this.grid[o][l]=u;const d=this.findGroups().length>0;return this.grid[e][a]=u,this.grid[o][l]=h,d};for(let e=0;e<In;e++)for(let a=0;a<kn;a++)if(a<kn-1&&t(e,a,e,a+1)||e<In-1&&t(e,a,e+1,a)||this.grid[e][a]?.special==="bomb")return!0;return!1}async reshuffle(){this.busy=!0;const t=this.gems().filter(e=>!e.block);for(let e=0;e<30;e++){const a=Bd(t.map(o=>o.res));if(t.forEach((o,l)=>{o.res=a[l]}),this.hasMove()&&this.findGroups().length===0)break}this.onFx("bad",0,0),this.onChange(),await Os(220),this.busy=!1}resetNeutral(){this.busy=!0,this.blockUntil=0,this.fogUntil=0,this.initFill(),this.onChange(),this.busy=!1}}function ea(s,t){return Object.keys(t).every(e=>s.res[e]>=(t[e]??0))}function ag(s,t){Object.keys(t).forEach(e=>{s.res[e]-=t[e]??0})}function br(s,t,e){s.res[t]+=e,s.lastGain[t]=performance.now()}function TS(s){s.vp>=10&&!$.won&&($.won=!0,$.running=!1,Kt.emit("win",s))}function yf(s,t,e=!1){return!sc($.map,s,t)||!e&&!ea(s,Ln.road.cost)?!1:(e||ag(s,Ln.road.cost),$.map.edges[t].owner=s.i,s.roads.push(t),Kt.emit("build",{p:s,kind:"road"}),!0)}function sg(s,t,e=!1){if(!ac($.map,s,t,$.setupPhase||e)||!e&&!ea(s,Ln.settlement.cost))return!1;e||ag(s,Ln.settlement.cost);const a=$.map.verts[t];return a.building="settlement",a.owner=s.i,s.settlements.push(t),s.vp+=Ln.settlement.vp,Kt.emit("build",{p:s,kind:"settlement"}),TS(s),!0}function AS(s,t){if(!Dy($.map,s,t)||!ea(s,Ln.city.cost))return!1;ag(s,Ln.city.cost);const e=$.map.verts[t];return e.building="city",s.settlements=s.settlements.filter(a=>a!==t),s.cities.push(t),s.vp+=Ln.city.vp,Kt.emit("build",{p:s,kind:"city"}),TS(s),!0}function wS(s,t){if(t<0||!$.map.verts[t])return!1;const e=$.map.verts[t];if(e.building)return!1;for(const a of Cy($.map,t))if($.map.verts[a].building)return!1;return e.building="capital",e.owner=s.i,s.capital=t,Kt.emit("build",{p:s,kind:"capital"}),!0}function xR(s,t=2){if(s.capital<0||!$.map.verts[s.capital])return;let e=s.capital,a=-1;for(let o=0;o<t;o++){const u=$.map.verts[e].edges.filter(p=>{const g=$.map.edges[p];return g.owner!==-1||!g.rail?!1:(g.a===e?g.b:g.a)!==a});if(!u.length)break;const h=u[Math.floor(Math.random()*u.length)];yf(s,h,!0);const d=$.map.edges[h];a=e,e=d.a===e?d.b:d.a}}function yR(s,t){const e=Lm($.map,s,t);if(e<0)return!1;const a=$.players[e];let o=!1;for(const l of Object.keys(s.res)){const u=Math.floor(s.res[l]/2);u>0&&(s.res[l]-=u,a.res[l]+=u,o=!0)}return s.tollAccess.add(e),Kt.emit("toll",{payer:s,owner:a,paidAny:o}),Kt.emit("build",{p:s,kind:"toll"}),!0}function RS(s,t){return s.res.gold<ti.bandit.gold?!1:(s.res.gold-=ti.bandit.gold,$.map.tiles[t].banditUntil=performance.now()+aE,Kt.emit("sabotage",{attacker:s,key:"bandit",tile:t}),!0)}function SR(s){return s.securedUntil>performance.now()}function MR(s){return s.res.gold<Wa.gold?!1:(s.res.gold-=Wa.gold,s.securedUntil=performance.now()+Wa.ms,Kt.emit("security",{p:s}),!0)}function CS(s,t,e){const a=ti[t];if(s.res.gold<a.gold||t==="fog"&&SR(e))return!1;if(s.res.gold-=a.gold,e.human){const o=performance.now();t==="harden"?$.board.harden(7):t==="block"?$.board.dropBlocks(2,ax,o):t==="fog"&&$.board.fog(ix,o)}else e.slowedUntil=performance.now()+(t==="fog"?ix:ax);return Kt.emit("sabotage",{attacker:s,key:t,victim:e}),!0}function bm(s,t){let e=-1,a=-1/0;return $.map.verts.forEach(o=>{if(!ac($.map,s,o.i,t))return;let l=Bo(80)/100;const u=new Set;for(const h of o.tiles){const d=$.map.tiles[h],p=d?bR(d):null;if(!p)continue;const g=s.settlements.concat(s.cities).some(_=>$.map.verts[_].tiles.includes(h));l+=g?1:0,u.has(p)||(l+=2.2,u.add(p)),d.type==="goldmine"&&(l+=1.6)}l>a&&(a=l,e=o.i)}),e}function bR(s){return{forest:"wood",hills:"brick",pasture:"sheep",field:"wheat",mountain:"ore",goldmine:"gold",desert:null}[s.type]}function ER(s){const t=[];return $.map.edges.forEach(e=>{sc($.map,s,e.i)&&t.push(e.i)}),t.length?Ya(t):-1}function TR(s,t){const e=new Set;s.settlements.concat(s.cities).forEach(l=>$.map.verts[l].tiles.forEach(u=>e.add(u)));const a=new Set;t.settlements.concat(t.cities).forEach(l=>$.map.verts[l].tiles.forEach(u=>a.add(u)));const o=[...e].filter(l=>!a.has(l)&&$.map.tiles[l].banditUntil<performance.now());return o.length?Ya(o):-1}function rg(s){return $.offers.filter(t=>t.from===s.i)}function DS(s,t,e,a,o){if(t===a||s.res[t]<e||rg(s).length>=3)return!1;s.res[t]-=e;const l={id:$.offerSeq++,from:s.i,give:t,giveN:e,want:a,wantN:o,born:performance.now()};return $.offers.unshift(l),Kt.emit("market:changed",l),!0}function US(s,t){const e=$.offers.findIndex(l=>l.id===t);if(e<0)return!1;const a=$.offers[e];if(a.from===s.i||s.res[a.want]<a.wantN)return!1;const o=$.players[a.from];return s.res[a.want]-=a.wantN,br(o,a.want,a.wantN),br(s,a.give,a.giveN),$.offers.splice(e,1),Kt.emit("market:changed",{o:a,taker:s}),!0}function AR(s,t){const e=$.offers.findIndex(o=>o.id===t);if(e<0)return!1;const a=$.offers[e];return a.from!==s.i?!1:(s.res[a.give]+=a.giveN,$.offers.splice(e,1),Kt.emit("market:changed",a),!0)}function wR(s,t,e){return t===e||s.res[t]<4?!1:(s.res[t]-=4,br(s,e,1),Kt.emit("market:changed",{bank:!0}),!0)}function RR(s){for(let t=$.offers.length-1;t>=0;t--){const e=$.offers[t];s-e.born>iE&&($.players[e.from].res[e.give]+=e.giveN,$.offers.splice(t,1),Kt.emit("market:changed",e))}}const CR={harden:5,block:1,fog:2,bandit:3};function DR(s,t){for(const e of $.players){if(e.human)continue;const a=e.slowedUntil>s?.35:1;e.nextIncome-=t*a,e.nextBuild-=t*a,e.nextTrade-=t,e.nextEvil-=t,e.nextIncome<=0&&(UR(e,s),e.nextIncome=7e3-e.skill*2200+gr(4500)),e.nextBuild<=0&&(LR(e),e.nextBuild=9e3+gr(7e3)),e.nextTrade<=0&&(NR(e),e.nextTrade=15e3+gr(15e3)),e.nextEvil<=0&&(e.nextEvil=OR(e))}}function UR(s,t){const e=Nm($.map,s,t),a=Object.keys(e);if(!a.length)return;const o=1+(Math.random()<s.skill*.55?1:0);for(let l=0;l<o;l++){const u=Ya(a);Math.random()<.55+s.skill*.3&&br(s,u,e[u])}Math.random()<.16+s.skill*.12&&br(s,"gold",1)}function LR(s){if(s.settlements.length&&ea(s,Ln.city.cost)&&AS(s,Ya(s.settlements))){Kt.emit("log",{who:s.i,text:`${s.name} raised a Foundry.`});return}if(ea(s,Ln.settlement.cost)){const t=bm(s,!1);if(t>=0&&sg(s,t)){Kt.emit("log",{who:s.i,text:`${s.name} built a Factory.`});return}}if(Math.random()<.7&&s.roads.length<12&&ea(s,Ln.road.cost)){const t=ER(s);t>=0&&yf(s,t)}}function NR(s){if(Math.random()<.75){for(const l of $.offers)if(l.from!==s.i&&s.res[l.want]>=l.wantN&&s.res[l.want]>l.wantN&&US(s,l.id))return}if(rg(s).length>=3)return;let t=null,e=2,a=null,o=1/0;for(const l of Vi)l!=="gold"&&(s.res[l]>e&&(e=s.res[l],t=l),s.res[l]<o&&(o=s.res[l],a=l));t&&a&&t!==a&&s.res[t]>=3&&DS(s,t,1+Bo(2),a,1+Bo(2))}function OR(s){const t=Object.keys(ti).filter(l=>s.res.gold>=ti[l].gold);if(!t.length)return 14e3+gr(1e4);const e=[];t.forEach(l=>{for(let u=0;u<CR[l];u++)e.push(l)});const a=Ya(e);let o;if(Math.random()<.6?o=$.players[0]:o=[...$.players].sort((l,u)=>u.vp-l.vp)[0],o.i===s.i&&(o=$.players[0]),(a==="bandit"||a==="fog")&&o.securedUntil>performance.now())return o.human&&Kt.emit("toast",{text:`Your Security Forces repelled ${s.name}'s ${ti[a].name}!`,kind:"success"}),12e3+gr(1e4);if(a==="bandit"){const l=TR(o,s);if(l<0)return 4e3;RS(s,l),o.human&&Kt.emit("toast",{text:`${s.name} set a Blockade on your district!`,kind:"danger"}),Kt.emit("log",{who:s.i,text:`${s.name} set a Blockade.`})}else{if(!CS(s,a,o))return 1e4+gr(8e3);o.human&&Kt.emit("toast",{text:`${s.name} unleashed ${ti[a].name} on your quarry!`,kind:"danger"}),Kt.emit("log",{who:s.i,text:`${s.name} used ${ti[a].name} on ${o.name}.`})}return 32e3+gr(24e3)}let $n;const ut={},Uo=new Map;let Va=null,wo=null;const of=[];function Hs(s,t=20){const a=(Cm[s]??0)*100/(ic-1);return`<i class="gem-ic" style="width:${t}px;height:${t}px;background-image:url(${Rm});background-size:${ic*100}% 100%;background-position:${a}% 50%"></i>`}const Pt=(s,t,e)=>{const a=document.createElement(s);return t&&(a.className=t),e!==void 0&&(a.innerHTML=e),a},og=s=>Object.keys(s).map(t=>`${s[t]}${Hs(t,16)}`).join(" ");function PR(s){$n=s,$n.innerHTML="";const t=Pt("canvas","map-canvas");t.id="map",$n.appendChild(t),ut.canvas=t,$n.appendChild(Pt("div","vignette"));const e=Pt("header","topbar");e.appendChild(Pt("div","logo",'<span class="logo-mark">⚙️</span> HEXMATCH <em>INDUSTRIES</em>')),ut.kingdoms=Pt("div","kingdoms"),e.appendChild(ut.kingdoms);const a=Pt("div","top-right");ut.vp=Pt("div","vp-badge"),a.appendChild(ut.vp);const o=Pt("button","icon-btn","❔");o.title="How to play",o.onclick=()=>NS();const l=Pt("button","icon-btn","🎯");l.title="Recenter map",l.onclick=()=>Kt.emit("fit"),a.appendChild(l),a.appendChild(o),e.appendChild(a),$n.appendChild(e);const u=Pt("footer","resbar");ut.chips=Pt("div","chipbar"),u.appendChild(ut.chips),$n.appendChild(u);const h=Pt("aside","aside left"),d=Pt("div","panel");d.appendChild(Pt("div","panel-title","🏗️ Build")),ut.build=Pt("div","build-list"),d.appendChild(ut.build),h.appendChild(d);const p=Pt("div","panel grow");p.appendChild(Pt("div","panel-title","🕵️ Black Market")),ut.sabotage=Pt("div","sab-list"),p.appendChild(ut.sabotage),h.appendChild(p),$n.appendChild(h),ut.offerTray=Pt("div","offer-tray hidden"),$n.appendChild(ut.offerTray);const g=Pt("aside","aside right"),_=Pt("div","panel"),v=Pt("div","quarry-head");v.appendChild(Pt("div","panel-title","💎 Your Quarry")),ut.quarryStatus=Pt("div","quarry-status"),v.appendChild(ut.quarryStatus),ut.comboBank=Pt("div","combo-bank"),v.appendChild(ut.comboBank);const x=Pt("button","reset-btn","♻ Reset");x.title="Collapse the quarry: lose ALL resources, get a fresh neutral board",x.onclick=()=>Kt.emit("board:reset"),v.appendChild(x),_.appendChild(v);const b=Pt("div","upbar");ut.upbarFill=Pt("div","upbar-fill"),b.appendChild(ut.upbarFill),_.appendChild(b);const C=Pt("div","board-wrap");ut.grid=Pt("div","grid"),ut.grid.style.width=ha*kn+"px",ut.grid.style.height=ha*In+"px",C.appendChild(ut.grid),ut.fog=Pt("div","fog-overlay","🌫️ WAR FOG"),C.appendChild(ut.fog),_.appendChild(C),g.appendChild(_),ut.boardWrap=C;const M=Pt("div","panel grow"),y=Pt("div","tabs");ut.tabMarket=Pt("button","tab active","Market"),ut.tabBank=Pt("button","tab","Bank"),ut.tabFeed=Pt("button","tab","Feed"),ut.tabMarket.onclick=()=>Tp("market"),ut.tabBank.onclick=()=>Tp("bank"),ut.tabFeed.onclick=()=>Tp("feed"),y.appendChild(ut.tabMarket),y.appendChild(ut.tabBank),y.appendChild(ut.tabFeed),M.appendChild(y),ut.marketPane=Pt("div","pane market-pane"),ut.bankPane=Pt("div","pane bank-pane hidden"),ut.feedPane=Pt("div","pane feed-pane hidden"),M.appendChild(ut.marketPane),M.appendChild(ut.bankPane),M.appendChild(ut.feedPane),g.appendChild(M),$n.appendChild(g),ut.toasts=Pt("div","toasts"),$n.appendChild(ut.toasts),ut.modebar=Pt("div","modebar hidden"),$n.appendChild(ut.modebar),ut.banner=Pt("div","banner hidden"),$n.appendChild(ut.banner),ut.modalRoot=Pt("div","modal-root hidden"),$n.appendChild(ut.modalRoot),ut.mobileNav=Pt("nav","mnav");const I=[["map","🗺","Map"],["quarry","💎","Quarry"],["build","🏗","Build"],["trade","⇄","Trade"]];for(const[D,A,O]of I){const U=Pt("button","mnav-btn"+(D==="map"?" active":""));U.dataset.view=D,U.innerHTML=`<i>${A}</i><span>${O}</span>`,U.onclick=()=>BR(D),ut.mobileNav.appendChild(U)}$n.appendChild(ut.mobileNav),$n.dataset.view="map",YR(),kR(),FR(),lf(),window.addEventListener("resize",lf),window.addEventListener("orientationchange",lf)}function BR(s){$n.dataset.view=s,ut.mobileNav.querySelectorAll(".mnav-btn").forEach(t=>{t.classList.toggle("active",t.dataset.view===s)}),s==="quarry"&&lf()}const IR=()=>window.innerWidth<=760;function lf(){const s=ut.boardWrap,t=ha*kn;let e=1;if(IR()){const a=window.innerWidth-24,o=window.innerHeight-210;e=Math.min(a/t,o/t,1),e=Math.max(.4,e)}else{const a=window.innerHeight;a<=720?e=.68:a<=800?e=.8:a<=900&&(e=.9)}s.style.zoom=String(e)}function dn(){const s=$.players[0],t=performance.now();ut.chips.innerHTML="";for(const e of Vi){const a=Pt("div","chip");(s.lastGain[e]??0)>t-700&&a.classList.add("pulse"),a.style.setProperty("--c1",jn[e].c1),a.style.setProperty("--c2",jn[e].c2),a.innerHTML=`<span class="chip-ic">${Hs(e,22)}</span><span class="chip-n">${s.res[e]}</span>`,ut.chips.appendChild(a)}ut.vp.innerHTML=`<span class="vp-star">★</span> ${s.vp}<span class="vp-tot">/${Dm.target}</span>`}function zR(s){if(s.human)return"pt-you";const t=s.name.toLowerCase();return t.includes("krag")?"pt-krag":t.includes("vex")?"pt-vex":t.includes("torvin")?"pt-torvin":""}function Wn(){const s=performance.now(),t=[...$.players].sort((e,a)=>a.vp-e.vp);ut.kingdoms.innerHTML="";for(const e of t){const a=Pt("div","king"+(e.human?" self":"")+($.pendingSabotage&&!e.human?" targetable":"")),o=e.slowedUntil>s;a.style.setProperty("--pc",e.color),a.innerHTML=`
      <div class="king-av has-portrait ${zR(e)}">${e.name[0]}</div>
      <div class="king-mid">
        <div class="king-name">${e.name}${e.human?" <span class='you'>YOU</span>":""}${o?" <span class='sabbed'>⚠ hit</span>":""}</div>
        <div class="king-bar"><i style="width:${Math.min(100,e.vp/Dm.target*100)}%;background:${e.color}"></i></div>
      </div>
      <div class="king-vp">${e.vp}<small>★</small></div>`,$.pendingSabotage&&!e.human&&(a.onclick=()=>Kt.emit("player:click",e.i)),ut.kingdoms.appendChild(a)}}function Gs(){const s=$.players[0];ut.build.innerHTML="";const t=[{mode:"road",bg:"bg-rail"},{mode:"settlement",bg:"bg-factory"},{mode:"city",bg:"bg-foundry"}];for(const o of t){const l=Ln[o.mode],u=ea(s,l.cost)||$.setupPhase,h=$.buildMode===o.mode,d="build-btn "+o.bg+(h?" active":u?" ready":" disabled"),p=Pt("button",d);p.innerHTML=`<span class="bb-mid"><b>${l.label}</b><small>${og(l.cost)}${l.vp?` · +${l.vp}★`:""}</small></span>`,p.onclick=()=>Kt.emit("build:mode",o.mode),ut.build.appendChild(p)}const e=$.buildMode==="toll",a=Pt("button","build-btn toll-btn"+(e?" active":$.setupPhase?" disabled":" ready"));a.innerHTML=`<span class="bb-mid"><b>Toll Pass</b><small>use a rival's rails · ½ your goods</small></span>`,a.onclick=()=>Kt.emit("build:mode","toll"),ut.build.appendChild(a)}function ka(){const s=$.players[0];ut.sabotage.innerHTML="";for(const d of Object.keys(ti)){const p=ti[d],g=s.res.gold>=p.gold,_=$.pendingSabotage===d||d==="bandit"&&$.buildMode==="bandit",v=Pt("button","sab-btn sb-"+d+(g?"":" disabled")+(_?" active":""));v.innerHTML=`<div class="sab-top"><b>${p.name}</b><span class="sab-cost">${p.gold}🪙</span></div>
      <div class="sab-desc">${p.desc}</div>`,v.onclick=()=>Kt.emit("sabotage:buy",d),ut.sabotage.appendChild(v)}const t=s.securedUntil>performance.now(),e=s.res.gold>=Wa.gold,a=Pt("button","sab-btn secure-btn"+(t?" active":e?"":" disabled")),o=t?` (${Math.ceil((s.securedUntil-performance.now())/1e3)}s)`:"";a.innerHTML=`<div class="sab-top"><b>🛡️ ${Wa.name}${o}</b><span class="sab-cost">${Wa.gold}🪙</span></div>
    <div class="sab-desc">${Wa.desc}</div>`,a.onclick=()=>Kt.emit("security:buy"),ut.sabotage.appendChild(a);const l=og(dr),u=ea(s,dr),h=Pt("button","sab-btn repair-btn"+(u?"":" disabled"));h.innerHTML=`<div class="sab-top"><b>🔧 Repair Crew</b><span class="sab-cost">${l}</span></div>
    <div class="sab-desc">Clear all Iron Girders & thaw all Frost tiles instantly.</div>`,h.onclick=()=>Kt.emit("repair:buy"),ut.sabotage.appendChild(h)}function FR(){const s=p=>{const g=Pt("select","res-sel");return Vi.forEach(_=>{const v=document.createElement("option");v.value=_,v.text=jn[_].name,g.appendChild(v)}),ut[p]=g,g},t=(p,g)=>{const _=Pt("input","res-num");return _.type="number",_.min="1",_.max="9",_.value=String(g),ut[p]=_,_},e=Pt("div","trade-form"),a=Pt("div","trade-row");a.appendChild(Pt("span","trade-lbl","Give")),a.appendChild(t("giveN",1)),a.appendChild(s("giveSel"));const o=Pt("div","trade-row");o.appendChild(Pt("span","trade-lbl","Want")),o.appendChild(t("wantN",1)),o.appendChild(s("wantSel")),ut.giveSel.value="wood",ut.wantSel.value="ore",ut.postBtn=Pt("button","post-btn","Post Offer"),ut.postBtn.onclick=()=>{const p=$.players[0],g=ut.giveSel.value,_=ut.wantSel.value,v=Math.max(1,+ut.giveN.value),x=Math.max(1,+ut.wantN.value);if(g===_){_e("Pick two different goods to trade.","danger");return}if(p.res[g]<v){_e(`Not enough ${jn[g].name} — you have ${p.res[g]}, the offer needs ${v}.`,"danger");return}if(rg(p).length>=3){_e("You already have 3 offers live. Cancel one first.","danger");return}Kt.emit("offer:create",{give:g,giveN:v,want:_,wantN:x})},e.appendChild(a),e.appendChild(o),e.appendChild(ut.postBtn),ut.marketForm=e,ut.mineHead=Pt("div","mine-head"),ut.mineList=Pt("div","offer-list mine"),ut.marketPane.appendChild(e),ut.marketPane.appendChild(ut.mineHead),ut.marketPane.appendChild(ut.mineList);const l=Pt("div","trade-form"),u=Pt("div","trade-row");u.appendChild(Pt("span","trade-lbl","Give")),u.appendChild(Pt("span","bank-fixed","4")),u.appendChild(s("bankGiveSel"));const h=Pt("div","trade-row");h.appendChild(Pt("span","trade-lbl","Get")),h.appendChild(Pt("span","bank-fixed","1")),h.appendChild(s("bankWantSel")),ut.bankGiveSel.value="wood",ut.bankWantSel.value="ore";const d=Pt("button","post-btn","Exchange");d.onclick=()=>Kt.emit("bank:trade",{give:ut.bankGiveSel.value,want:ut.bankWantSel.value}),l.appendChild(u),l.appendChild(h),l.appendChild(d),ut.bankPane.appendChild(l),ut.bankPane.appendChild(Pt("div","pane-note","The bank always trades four of one good for one of another. No rival required, no waiting."))}function Lo(){const s=$.players[0],t=performance.now(),e=$.offers.filter(a=>a.from===s.i);ut.mineHead.innerHTML=`<span>Your offers</span><span class="slot-count${e.length>=3?" full":""}">${e.length}/3</span>`,ut.postBtn.classList.toggle("disabled",e.length>=3),ut.postBtn.textContent=e.length>=3?"Cancel an offer first":"Post Offer",ut.mineList.innerHTML="",e.length||ut.mineList.appendChild(Pt("div","empty","No offers posted. Rivals can't see you yet."));for(const a of e){const o=Math.max(0,Math.ceil((4e4-(t-a.born))/1e3)),l=Pt("div","offer");l.style.setProperty("--pc",s.color),l.innerHTML=`
      <div class="offer-who"><b style="color:${s.color}">You</b><span class="offer-t">${o}s</span></div>
      <div class="offer-body">
        <span class="give">${a.giveN}${Hs(a.give,16)}</span>
        <span class="arrow">➜</span>
        <span class="want">${a.wantN}${Hs(a.want,16)}</span>
      </div>`;const u=Pt("div","offer-act"),h=Pt("button","mini danger","Cancel");h.onclick=()=>Kt.emit("offer:cancel",a.id),u.appendChild(h),l.appendChild(u),ut.mineList.appendChild(l)}HR()}let Ep="";function HR(){const s=$.players[0],t=ut.offerTray,e=$.offers.filter(l=>l.from!==s.i);if(!e.length){t.classList.add("hidden"),Ep="";return}t.classList.remove("hidden");const a=e.map(l=>`${l.id}:${s.res[l.want]>=l.wantN?1:0}`).join(",");if(a===Ep){VR();return}Ep=a;const o=new Map;for(const l of e)o.has(l.from)||o.set(l.from,[]),o.get(l.from).push(l);t.innerHTML="";for(const[l,u]of o){const h=$.players[l],d=Pt("div","tray-group");if(d.style.setProperty("--pc",h.color),d.appendChild(wy(u[0],h,s,!0)),u.length>1){d.appendChild(GR(u.length-1));const p=Pt("div","tray-more");u.slice(1).forEach(g=>p.appendChild(wy(g,h,s,!1))),d.appendChild(p)}t.appendChild(d)}}function wy(s,t,e,a){const o=e.res[s.want]>=s.wantN,l=Pt("div","tray-offer");l.innerHTML=`
    <span class="tray-who">${a?t.name:""}</span>
    <span class="tray-t" data-born="${s.born}"></span>
    <span class="tray-body">${s.giveN}${Hs(s.give,15)}<i class="arrow">➜</i>${s.wantN}${Hs(s.want,15)}</span>`;const u=Pt("button","mini"+(o?"":" disabled"),"Take");return u.onclick=h=>{h.stopPropagation(),Kt.emit("offer:accept",s.id)},l.appendChild(u),l}function GR(s){const t=Pt("div","tray-showmore");return t.innerHTML=`<span>Show more</span><span class="more-count">${s}</span>`,t}function VR(){const s=performance.now();ut.offerTray.querySelectorAll("[data-born]").forEach(t=>{const e=+t.dataset.born;t.textContent=Math.max(0,Math.ceil((4e4-(s-e))/1e3))+"s"})}function Tp(s){ut.tabMarket.classList.toggle("active",s==="market"),ut.tabBank.classList.toggle("active",s==="bank"),ut.tabFeed.classList.toggle("active",s==="feed"),ut.marketPane.classList.toggle("hidden",s!=="market"),ut.bankPane.classList.toggle("hidden",s!=="bank"),ut.feedPane.classList.toggle("hidden",s!=="feed")}function kR(){Kt.on("log",s=>{of.unshift(s),of.length>40&&of.pop(),LS()})}function LS(){ut.feedPane.innerHTML="",of.slice(0,14).forEach(s=>{const t=$.players[s.who],e=Pt("div","feed-row");e.style.borderLeftColor=t?t.color:"#888",e.textContent=s.text,ut.feedPane.appendChild(e)})}function XR(s){const t=$.board;let e="";t.fogUntil>s&&(e+=`<span class="stat fog">🌫️ ${Math.ceil((t.fogUntil-s)/1e3)}s</span>`),t.blockUntil>s&&(e+=`<span class="stat blk">⛓️ ${Math.ceil((t.blockUntil-s)/1e3)}s</span>`),ut.quarryStatus.innerHTML=e,ut.fog.classList.toggle("show",t.fogUntil>s)}function WR(s,t){if(!ut.comboBank)return;let e="";for(let a=0;a<t;a++)e+=`<i class="${a<s?"on":""}"></i>`;ut.comboBank.innerHTML=`<span class="cb-lbl">Combo</span>${e}`}function qR(s){ut.upbarFill.style.width=Math.min(100,s*100)+"%"}function YR(){const s=ut.grid,t=o=>{const l=s.getBoundingClientRect(),u=l.width/kn,h=l.height/In,d=Math.floor((o.clientX-l.left)/u),p=Math.floor((o.clientY-l.top)/h);return p<0||p>=In||d<0||d>=kn?null:{r:p,c:d}},e=(o,l)=>Math.abs(o.r-l.r)+Math.abs(o.c-l.c)===1,a=(o,l)=>$.board.trySwap(o.r,o.c,l.r,l.c,performance.now());s.addEventListener("pointerdown",o=>{const l=t(o);l&&(wo=l,Va&&e(Va,l)?(a(Va,l),Va=null):Va=l,Em())}),s.addEventListener("pointermove",o=>{if(!wo)return;const l=t(o);l&&e(wo,l)&&(a(wo,l),wo=null,Va=null,Em())}),window.addEventListener("pointerup",()=>{wo=null})}function Em(){if(Uo.forEach(s=>s.classList.remove("selected")),Va){const s=$.board.grid[Va.r][Va.c];s&&Uo.get(s.id)?.classList.add("selected")}}function ZR(s,t){const e=s.querySelector(".face"),a=s.querySelector(".icon"),o=s.querySelector(".badge");if(s.className="gem",e.removeAttribute("style"),e.className="face",t.block){s.classList.add("block"),a.className="icon",a.textContent="",o.className="badge";return}if(t.special==="bomb"){s.classList.add("bomb"),a.textContent="💣",a.className="icon bombic",o.className="badge";return}s.classList.add("res-"+t.res);const l=Cm[t.res]??0;e.classList.add("sprite"),e.style.backgroundImage=`url(${Rm})`,e.style.backgroundSize=`${ic*100}% 100%`,e.style.backgroundPosition=`${l*100/(ic-1)}% 50%`,a.className="icon",a.textContent="",o.className="badge",t.tier>0&&(o.textContent=String(t.tier),o.classList.add("show",`t${t.tier}`),s.classList.add("token")),t.hard===2?s.classList.add("hard2"):t.hard===1&&s.classList.add("hard1")}function Tm(){const s=new Set,t=$.board.gems();for(const e of t){s.add(e.id);let a=Uo.get(e.id);const o=e.c*ha+3,l=e.r*ha+3;a?a.style.transform=`translate(${o}px, ${l}px)`:(a=Pt("div","gem"),a.innerHTML='<div class="face"></div><span class="icon"></span><span class="badge"></span>',a.dataset.id=e.id,ut.grid.appendChild(a),Uo.set(e.id,a),e.isNew?(a.style.transition="none",a.style.transform=`translate(${o}px, ${l-ha*3}px)`,a.style.opacity="0",requestAnimationFrame(()=>requestAnimationFrame(()=>{a.style.transition="",a.style.transform=`translate(${o}px, ${l}px)`,a.style.opacity="1"}))):a.style.transform=`translate(${o}px, ${l}px)`),ZR(a,e),e.isNew=!1}Uo.forEach((e,a)=>{s.has(a)||(e.classList.add("gone"),setTimeout(()=>e.remove(),260),Uo.delete(a))}),Em()}function KR(s,t,e,a){const o=ut.grid,l=Pt("div","fx fx-"+s);l.style.left=e*ha+ha/2+"px",l.style.top=t*ha+ha/2+"px",a&&(l.textContent=a),o.appendChild(l),setTimeout(()=>l.remove(),s==="chain"?1e3:600)}function JR(s,t){const e=Pt("div","harvest-pop"),a=Object.keys(s).map(o=>`<span>${s[o]}${Hs(o,18)}</span>`).join("");e.innerHTML=(t?`<b class="hp-label">${t}</b>`:"")+`<div class="hp-body">${a}</div>`,ut.boardWrap.appendChild(e),setTimeout(()=>e.remove(),1600)}function _e(s,t="info"){const e=Pt("div","toast "+t,s);ut.toasts.appendChild(e),requestAnimationFrame(()=>e.classList.add("in")),setTimeout(()=>{e.classList.remove("in"),setTimeout(()=>e.remove(),300)},2400)}function xr(s){if(!s){ut.modebar.classList.add("hidden");return}ut.modebar.classList.remove("hidden");let t="",e="";if(s==="bandit"?(t="Click a district to set the Blockade",e=ti.bandit.gold+"🪙"):s==="capital"?(t="Click a glowing node to found your Capital",e="FREE"):s==="toll"?(t="Click a rival's rail (touching yours) to buy passage",e="½ your goods 💰"):$.setupPhase&&s==="road"?(t="Click a glowing border to lay your rail",e="FREE"):(t=`Click the map to place a ${Ln[s].label}`,e=og(Ln[s].cost)),ut.modebar.innerHTML=`<span class="mb-txt">${t}</span><span class="mb-cost">${e}</span>`,s!=="capital"&&!$.setupPhase){const a=Pt("button","mb-cancel","Cancel ✕");a.onclick=()=>Kt.emit("build:mode",null),ut.modebar.appendChild(a)}}function Am(s){if(!s){ut.banner.classList.add("hidden");return}ut.banner.classList.remove("hidden"),ut.banner.innerHTML='<button class="banner-close" title="Hide">✕</button>'+s,ut.banner.querySelector(".banner-close").onclick=()=>ut.banner.classList.add("hidden")}function NS(){ut.modalRoot.classList.remove("hidden"),ut.modalRoot.innerHTML=`
  <div class="modal-back"></div>
  <div class="modal box">
    <h2>⚙️ HEXMATCH INDUSTRIES</h2>
    <p class="sub">Two worlds, one empire. First to <b>${Dm.target}★ Victory Points</b> wins.</p>
    <div class="help-cols">
      <div class="help-col">
        <h3>🏙️ The Territory</h3>
        <p>Found your <b>Headquarters</b> 🏰 — every rail traces back to it. Build <b>Factories</b> (+1★) & <b>Foundries</b> (+2★) at <b>crossroads</b> where districts meet. Boxed in? Buy a <b>Toll Pass</b> 💰 to run your line through a rival's rails (½ your goods). Terrain by your buildings unlocks <b>gem colours</b>.</p>
      </div>
      <div class="help-col">
        <h3>💎 The Quarry</h3>
        <p>Plain gems are worthless. Every 20s your accessible colours turn into numbered <b>resource tokens</b> — match them to harvest. Match 4 doubles, match 5 makes a <b>bomb</b>. <b>Gold coins</b> 🪙 are <b>wild</b> — they combo with any 2 gems and pay Gold.</p>
      </div>
      <div class="help-col">
        <h3>🪙 Gold, Trade & Defence</h3>
        <p>Collect wild <b>Gold coins</b> to fund the <b>Black Market</b>: sabotage rivals or hire <b>Security Forces</b> for protection. Trade in the live market, or bank <b>4:1</b>. Beware the <b>Taxman</b> — he bleeds the richest tycoon!</p>
      </div>
    </div>
    <button class="big-btn" id="startBtn">Start Production ⚙️</button>
  </div>`,ut.modalRoot.querySelector("#startBtn").onclick=()=>{ut.modalRoot.classList.add("hidden")}}function QR(s){ut.modalRoot.classList.remove("hidden"),ut.modalRoot.innerHTML=`
  <div class="modal-back"></div>
  <div class="modal box small">
    <h2>${s.human?"🏆 Victory!":"📉 Bankrupt"}</h2>
    <p class="sub" style="color:${s.color}"><b>${s.name}</b> reached ${s.vp}★ and dominates the market.</p>
    <button class="big-btn" id="againBtn">Play Again</button>
  </div>`,ut.modalRoot.querySelector("#againBtn").onclick=()=>location.reload()}function $R(s,t,e){ut.modalRoot.classList.remove("hidden"),ut.modalRoot.innerHTML=`
  <div class="modal-back"></div>
  <div class="modal box small">
    <h2>${s}</h2>
    <p class="sub">${t}</p>
    <div class="confirm-row">
      <button class="big-btn ghost" id="noBtn">Cancel</button>
      <button class="big-btn danger" id="yesBtn">Collapse</button>
    </div>
  </div>`;const a=()=>ut.modalRoot.classList.add("hidden");ut.modalRoot.querySelector("#noBtn").onclick=a,ut.modalRoot.querySelector("#yesBtn").onclick=()=>{a(),e()},ut.modalRoot.querySelector(".modal-back").onclick=a}function jR(s,t,e){const a={wood:0,brick:0,sheep:0,wheat:0,ore:0,gold:0},o=()=>t-Vi.reduce((u,h)=>u+a[h],0);ut.modalRoot.classList.remove("hidden");const l=()=>{const u=Vi.map(d=>`
      <div class="tax-row">
        <span class="tax-ic">${Hs(d,20)}</span>
        <span class="tax-nm">${jn[d].name}</span>
        <button class="tax-btn" data-k="${d}" data-d="-1">−</button>
        <span class="tax-ct"><b>${a[d]}</b> / ${s.res[d]}</span>
        <button class="tax-btn" data-k="${d}" data-d="1">+</button>
      </div>`).join("");ut.modalRoot.innerHTML=`
    <div class="modal-back"></div>
    <div class="modal box small">
      <h2>💼 The Taxman</h2>
      <p class="sub">You lead the market — time to pay up. Surrender <b>${t}</b> goods of your choosing.</p>
      <div class="tax-list">${u}</div>
      <p class="tax-left">Still to surrender: <b>${o()}</b></p>
      <button class="big-btn danger" id="payBtn" ${o()===0?"":"disabled"}>Pay the Taxman</button>
    </div>`,ut.modalRoot.querySelectorAll(".tax-btn").forEach(d=>{d.onclick=()=>{const p=d.dataset.k,g=+d.dataset.d,_=a[p]+g;_<0||_>s.res[p]||g>0&&o()<=0||(a[p]=_,l())}});const h=ut.modalRoot.querySelector("#payBtn");h&&(h.onclick=()=>{for(const d of Vi)s.res[d]-=a[d];ut.modalRoot.classList.add("hidden"),e()})};l()}function tC(s){const t=$.map.tiles[s],e=cf[t.type].res,a=e?Nm($.map,$.players[0],performance.now()):{},o=e&&a[e];_e(`${cf[t.type].name}${e?" · "+jn[e].name:" · barren"}${o?" (harvesting)":""}`,"info")}const eC=()=>ut.canvas,nC=[{name:"You",human:!0,color:"#39b6ff"},{name:"Krag Steelworks",human:!1,color:"#e0503a"},{name:"Vex Industries",human:!1,color:"#c05cff"},{name:"Torvin & Sons",human:!1,color:"#4ecb6e"}];let Sn,oi,Ap=0;function iC(s){$.players=nC.map((o,l)=>rE(l,o.name,o.human,o.color)),$.map=fE(),$.offers=[],$.offerSeq=1,$.won=!1,$.running=!0,$.setupPhase=!0,$.buildMode=null,$.pendingSabotage=null,$.upgradeTimer=0,$.access={},$.raidTimer=nx,oi=new ig,$.board=oi,oi.onHarvest=(o,l)=>{br($.players[0],o,l)},oi.onGold=o=>{br($.players[0],"gold",o)},oi.onFx=(o,l,u,h)=>KR(o,l,u,h),oi.onChange=()=>Tm(),oi.onPopup=(o,l)=>JR(o,l),oi.onCombo=(o,l,u)=>{u&&_e("Combo bonus — a gold coin appeared in your quarry!","success"),WR(o,l)},PR(s),Sn=new _R(eC(),$.map),$.view=Sn,Sn.fit(),Sn.onPick=oC;for(let o=1;o<$.players.length;o++){const l=$.players[o];wS(l,bm(l,!0)),xR(l,2);const u=bm(l,!1);u>=0&&sg(l,u,!0)}cC(),$.setupPhase=!0,$.setupStep=0,Sf(),dn(),Wn(),Gs(),ka(),Lo(),LS(),Tm(),NS(),Kt.emit("log",{who:0,text:"Establish your HQ to launch your empire."});let t=performance.now(),e=0;const a=o=>{const l=Math.min(100,o-t);if(t=o,$.running&&!$.won&&($.setupPhase||($.upgradeTimer+=l,$.upgradeTimer>=ex&&($.upgradeTimer=0,oi.spawnTokens($.access),$.taxRound=($.taxRound||0)+1,$.taxRound>=nE&&($.taxRound=0,sC()))),$.setupPhase||(DR(o,l),RR(o),oi.tickEffects(o),$.raidTimer-=l,$.raidTimer<=0&&($.raidTimer=nx,aC())),e+=l,e>1e3)){e=0;const u=$.players[0];$.buildMode&&$.buildMode!=="toll"&&$.buildMode!=="bandit"&&Ln[$.buildMode]&&!ea(u,Ln[$.buildMode].cost)&&zs(),Lo(),dn(),Wn(),ka(),Gs()}qR($.setupPhase?0:$.upgradeTimer/ex),XR(o),lC(),Sn.draw(o,$.players),Ap=requestAnimationFrame(a)};return Ap=requestAnimationFrame(a),()=>cancelAnimationFrame(Ap)}function aC(){const s=Ya(Vi);let t=null,e=0;for(const l of $.players)l.res[s]>e&&(e=l.res[s],t=l);if(!t||e<2)return;const a=Math.min(t.res[s],Math.max(2,Math.floor(e/2)));t.res[s]-=a;const o=`📦 Smugglers raided ${t.name}, stealing ${a}${jn[s].icon} ${jn[s].name}!`;Kt.emit("log",{who:t.i,text:o}),t.human?_e(`Smugglers stole ${a} ${jn[s].name} from you!`,"danger"):_e(`Smugglers raided ${t.name}'s ${jn[s].name} stockpile.`,"info"),dn(),Wn()}function sC(){const s=o=>Vi.reduce((l,u)=>l+o.res[u],0);let t=null,e=-1;for(const o of $.players){const l=s(o);l>e&&(e=l,t=o)}if(!t||e<8)return;const a=Math.floor(e/2);if(t.human)jR(t,a,()=>{dn(),Wn()}),_e(`💼 The Taxman cometh! Surrender ${a} goods.`,"danger"),Kt.emit("log",{who:t.i,text:`The Taxman demanded ${a} goods from you.`});else{for(const o of Vi)t.res[o]=Math.ceil(t.res[o]/2);Kt.emit("log",{who:t.i,text:`The Taxman bled ${t.name} for half their goods.`}),_e(`The Taxman hit ${t.name} — the market leader!`,"info"),dn(),Wn()}}function Bs(){$.access=Nm($.map,$.players[0],performance.now()),oi.pool=Vi.filter(s=>s!=="gold")}function Sf(){if($.setupStep===0)$.buildMode="capital",Sn.mode="capital",Am("<b>Establish your Headquarters</b><br><small>The heart of your empire — all rails must trace back to it. Click a glowing node.</small>"),xr("capital");else{$.buildMode="road",Sn.mode="road";const s=$.setupStep===1?"first":"second";Am(`<b>Lay your ${s} Rail</b><br><small>Pick a glowing border connected to your network. It's free.</small>`),xr("road")}Gs()}function rC(){$.setupPhase=!1,$.buildMode=null,Sn.mode=null,Am(null),xr(null),Bs(),oi.initFill(),oi.spawnTokens($.access),Tm(),Gs(),_e("HQ established! Build rails outward, then factories. Rivals now stir.","success"),Kt.emit("log",{who:0,text:"The race to dominate the market begins!"})}function zs(){$.buildMode=null,$.pendingSabotage=null,Sn.mode=null,xr(null),Gs(),ka(),Wn()}function oC(s){if(!s)return;const t=$.players[0],e=$.buildMode;if(e==="bandit"&&s.kind==="tile"){RS(t,s.id)?(_e("Blockade set! That district is picketed.","success"),Kt.emit("log",{who:0,text:"You set up a Blockade."}),zs()):_e("Not enough Gold for a Blockade.","danger");return}if(e==="capital"&&s.kind==="vertex"&&$.setupPhase){wS(t,s.id)?(Bs(),$.setupStep=1,Sf(),dn(),Wn()):_e("Too close to another building — pick another node.","danger");return}if(e==="toll"&&s.kind==="edge"){const a=Lm($.map,t,s.id);if(a<0){_e("Click a rival's own rail that touches your network.","danger");return}const o=$.players[a];yR(t,s.id)?(_e(`Toll paid to ${o.name}! You may now build along their rails.`,"success"),Kt.emit("log",{who:0,text:`You paid a toll to ${o.name} for rail passage.`}),Bs(),zs(),dn(),Wn()):_e("Toll failed.","danger");return}if(e==="road"&&s.kind==="edge"){if($.setupPhase){if(!sc($.map,t,s.id)){_e("Pick a border connected to your network.","danger");return}yf(t,s.id,!0)&&($.setupStep++,Bs(),dn(),Wn(),$.setupStep>=3?rC():Sf());return}sc($.map,t,s.id)?yf(t,s.id)?(dn(),Gs()):_e("Not enough resources for a Rail.","danger"):_e("Rails must connect to your network (back to your HQ).","danger");return}if(e==="settlement"&&s.kind==="vertex"){if(!ac($.map,t,s.id,!1)){$.map.verts[s.id].building?_e("That node is taken.","danger"):_e("Must connect to your rail network, and not be next to another building.","danger");return}sg(t,s.id)?(_e("Factory built! +1★","success"),Kt.emit("log",{who:0,text:"You built a Factory."}),Bs(),zs(),dn(),Wn()):_e("Not enough resources.","danger");return}if(e==="city"&&s.kind==="vertex"){if(!Dy($.map,t,s.id)){_e("Upgrade one of your own factories.","danger");return}AS(t,s.id)?(_e("Foundry raised! +2★","success"),Kt.emit("log",{who:0,text:"You raised a Foundry."}),Bs(),zs(),dn(),Wn()):_e("Not enough resources (2🌾 3⚙️).","danger");return}!e&&s.kind==="tile"&&tC(s.id)}function lC(){const s=$.players[0];Sn.legalVerts.clear(),Sn.legalEdges.clear();const t=Sn.mode;t==="capital"?$.map.verts.forEach(e=>{ac($.map,s,e.i,!0)&&Sn.legalVerts.add(e.i)}):t==="road"?$.map.edges.forEach(e=>{sc($.map,s,e.i)&&Sn.legalEdges.add(e.i)}):t==="toll"?$.map.edges.forEach(e=>{Lm($.map,s,e.i)>=0&&Sn.legalEdges.add(e.i)}):t==="settlement"?$.map.verts.forEach(e=>{ac($.map,s,e.i,!1)&&Sn.legalVerts.add(e.i)}):t==="city"&&s.settlements.forEach(e=>Sn.legalVerts.add(e))}function cC(){Kt.on("build:mode",s=>{if($.setupPhase){Sf();return}if(s===null){zs();return}if($.pendingSabotage=null,$.buildMode===s){zs();return}const t=$.players[0];if(s!=="toll"&&!ea(t,Ln[s].cost)){const e=Ln[s].cost,a=Object.keys(e).filter(o=>t.res[o]<(e[o]??0)).map(o=>`${(e[o]??0)-t.res[o]} more ${jn[o].name}`).join(", ");_e(`Can't build ${Ln[s].label} — need ${a}.`,"danger");return}$.buildMode=s,Sn.mode=s,xr(s),Gs(),ka(),Wn()}),Kt.on("sabotage:buy",s=>{if($.players[0].res.gold<ti[s].gold){_e(`Need ${ti[s].gold} Gold.`,"danger");return}s==="bandit"?($.buildMode="bandit",$.pendingSabotage=null,Sn.mode=null,xr("bandit"),ka()):($.pendingSabotage=s,$.buildMode=null,Sn.mode=null,xr(null),_e(`${ti[s].name} armed — click a rival kingdom to strike.`,"info"),ka(),Wn()),Gs()}),Kt.on("player:click",s=>{const t=$.pendingSabotage;if(!t)return;const e=$.players[s];CS($.players[0],t,e)?(_e(`${ti[t].name} unleashed on ${e.name}!`,"success"),Kt.emit("log",{who:0,text:`You used ${ti[t].name} on ${e.name}.`})):_e("Sabotage failed.","danger"),$.pendingSabotage=null,dn(),Wn(),ka()}),Kt.on("offer:create",s=>{DS($.players[0],s.give,s.giveN,s.want,s.wantN)?_e("Offer posted to the market.","success"):_e("Can't post that offer (goods, duplicate, or 3-offer limit).","danger"),Lo(),dn()}),Kt.on("offer:accept",s=>{US($.players[0],s)?_e("Trade complete!","success"):_e("Offer already taken or unaffordable.","danger"),Lo(),dn()}),Kt.on("offer:cancel",s=>{typeof s=="number"&&AR($.players[0],s),Lo(),dn()}),Kt.on("market:changed",()=>{Lo(),dn()}),Kt.on("bank:trade",s=>{const t=$.players[0];if(s.give===s.want){_e("Pick two different resources.","danger");return}wR(t,s.give,s.want)?(_e(`Banked 4 ${jn[s.give].name} → 1 ${jn[s.want].name}.`,"success"),dn()):_e(`Need 4 ${jn[s.give].name} to bank.`,"danger")}),Kt.on("security:buy",()=>{const s=$.players[0];if(s.securedUntil>performance.now()){_e("Security is already active.","info");return}MR(s)?(_e(`Security Forces hired for ${Math.round(Wa.ms/1e3)}s — immune to Blockade & Smog.`,"success"),Kt.emit("log",{who:0,text:"You hired Security Forces."}),dn(),ka()):_e(`Need ${Wa.gold} Gold for Security.`,"danger")}),Kt.on("repair:buy",()=>{const s=$.players[0];if(!ea(s,dr)){_e(`Need ${Object.keys(dr).map(e=>dr[e]+jn[e].icon).join(" ")}.`,"danger");return}const t=oi.smashBlocks();if(t===0){_e("Nothing to repair — no blocks or frost.","info");return}for(const e of Object.keys(dr))s.res[e]-=dr[e]??0;_e(`Repair crew cleared ${t} obstacle${t>1?"s":""}!`,"success"),Kt.emit("log",{who:0,text:`You dispatched a repair crew (${t} obstacles cleared).`}),dn(),ka()}),Kt.on("fit",()=>Sn.fit()),Kt.on("build",s=>{s?.p?.human&&Bs(),dn(),Wn()}),Kt.on("sabotage",s=>{s?.key==="bandit"&&Bs(),dn(),Wn()}),Kt.on("win",s=>{$.won=!0,$.running=!1,QR(s)}),Kt.on("board:reset",()=>{if($.setupPhase||$.won)return;const s=$.players[0];$R("Collapse the Quarry?","You will lose <b>ALL</b> your resources and get a fresh board of blank neutral gems. Use this only when you're truly stuck.",()=>{for(const t of Vi)s.res[t]=0;oi.resetNeutral(),dn(),_e("Quarry collapsed. Fresh neutral board — start matching!","info"),Kt.emit("log",{who:0,text:"You collapsed your quarry for a fresh start."})})}),Kt.on("toast",s=>_e(s.text,s.kind||"info")),Kt.on("toll",s=>{s?.owner?.human&&_e(`${s.payer.name} paid you a rail toll!`,"success"),dn(),Wn()}),window.addEventListener("keydown",s=>{$.setupPhase||(s.key==="1"?Kt.emit("build:mode","road"):s.key==="2"?Kt.emit("build:mode","settlement"):s.key==="3"?Kt.emit("build:mode","city"):s.key==="4"?Kt.emit("build:mode","toll"):s.key==="Escape"&&zs())})}function uC(){const s=Pd.useRef(null),t=Pd.useRef(!1);return Pd.useEffect(()=>{if(!s.current||t.current)return;t.current=!0;const e=iC(s.current);return()=>{e&&e()}},[]),Ry.jsx("div",{ref:s,className:"game-root"})}Wb.createRoot(document.getElementById("root")).render(Ry.jsx(uC,{}));
