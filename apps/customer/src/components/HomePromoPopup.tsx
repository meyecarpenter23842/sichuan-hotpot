import React,{useCallback,useEffect,useMemo,useRef,useState} from "react";
import { AccessibilityInfo,Animated,AppState,Image,Modal,PanResponder,Platform,Pressable,
  StyleSheet,Text,View,useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { safeProductImageUrl,type HomePopupPayload } from "../api";

type Receipt={revision:number;shownAt:number};
const receiptKey=(branchId:string)=>"hotpot.home-popup.v1:"+branchId;

export function HomePromoPopup({branchId,payload,active}:{
  branchId:string;payload:HomePopupPayload|null;active:boolean;
}){
  const {width:viewportWidth,height:viewportHeight}=useWindowDimensions();
  const frameWidth=Math.min(480,Math.max(280,viewportWidth-32));
  const frameHeight=Math.min(frameWidth*1.16,viewportHeight*.68);
  const [visible,setVisible]=useState(false);
  const [index,setIndex]=useState(0);
  const [previousIndex,setPreviousIndex]=useState<number|null>(null);
  const [failed,setFailed]=useState<string[]>([]);
  const [foreground,setForeground]=useState(true);
  const [reducedMotion,setReducedMotion]=useState(false);
  const progress=useRef(new Animated.Value(1)).current;
  const transitionLock=useRef(false);
  const memoryReceipt=useRef<{branchId:string;revision:number;shownAt:number}|null>(null);
  const [eligibilityEpoch,setEligibilityEpoch]=useState(0);

  useEffect(()=>{
    let mounted=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(mounted)setReducedMotion(value);});
    const sub=AccessibilityInfo.addEventListener("reduceMotionChanged",setReducedMotion);
    return()=>{mounted=false;sub.remove();};
  },[]);
  useEffect(()=>{
    const update=()=>setForeground(Platform.OS==="web"
      ?typeof document==="undefined"||document.visibilityState==="visible"
      :AppState.currentState==="active");
    update();
    const app=AppState.addEventListener("change",update);
    if(Platform.OS==="web"&&typeof document!=="undefined")
      document.addEventListener("visibilitychange",update);
    return()=>{app.remove();if(Platform.OS==="web"&&typeof document!=="undefined")
      document.removeEventListener("visibilitychange",update);};
  },[]);

  const slides=useMemo(()=>(payload?.slides??[]).filter(slide=>
    !!safeProductImageUrl(slide.imageKey)&&!failed.includes(slide.id)),[payload,failed]);
  const revision=payload?.settings.revision??0;
  const enabled=payload?.settings.enabled===true;

  useEffect(()=>{
    if(!active||!branchId||!enabled||slides.length===0){setVisible(false);return;}
    if(visible)return;
    let cancelled=false;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const repeatMs=(payload?.settings.repeatIntervalMinutes??360)*60000;
    const memory=memoryReceipt.current;
    if(memory&&memory.branchId===branchId&&memory.revision===revision){
      const remaining=repeatMs-(Date.now()-memory.shownAt);
      if(remaining>0){
        timer=setTimeout(()=>setEligibilityEpoch(value=>value+1),Math.max(250,remaining));
        return()=>{cancelled=true;if(timer)clearTimeout(timer);};
      }
    }
    void AsyncStorage.getItem(receiptKey(branchId)).then(raw=>{
      if(cancelled)return;
      let stored:Receipt|null=null;
      try{stored=raw?JSON.parse(raw) as Receipt:null;}catch{stored=null;}
      const memory=memoryReceipt.current;
      const receipt=memory&&memory.branchId===branchId&&memory.revision===revision
        &&(!stored||stored.revision!==revision||memory.shownAt>stored.shownAt)
        ?{revision:memory.revision,shownAt:memory.shownAt}:stored;
      const elapsed=receipt&&receipt.revision===revision?Date.now()-receipt.shownAt:repeatMs;
      if(!receipt||receipt.revision!==revision||elapsed>=repeatMs){
        const shownAt=Date.now();
        memoryReceipt.current={branchId,revision,shownAt};
        setIndex(0);setPreviousIndex(null);setVisible(true);
        const next:Receipt={revision,shownAt};
        void AsyncStorage.setItem(receiptKey(branchId),JSON.stringify(next)).catch(()=>undefined);
        return;
      }
      timer=setTimeout(()=>setEligibilityEpoch(value=>value+1),Math.max(250,repeatMs-elapsed));
    }).catch(()=>{
      if(cancelled)return;
      const shownAt=Date.now();
      memoryReceipt.current={branchId,revision,shownAt};setIndex(0);setVisible(true);
    });
    return()=>{cancelled=true;if(timer)clearTimeout(timer);};
  },[active,branchId,eligibilityEpoch,enabled,payload?.settings.repeatIntervalMinutes,
    revision,slides.length,visible]);

  const goTo=useCallback((target:number)=>{
    if(slides.length<2||transitionLock.current)return;
    const normalized=(target+slides.length)%slides.length;
    if(normalized===index)return;
    transitionLock.current=true;setPreviousIndex(index);setIndex(normalized);
    progress.stopAnimation();progress.setValue(0);
    Animated.timing(progress,{toValue:1,duration:reducedMotion?0:320,useNativeDriver:true}).start(()=>{
      setPreviousIndex(null);transitionLock.current=false;
    });
  },[index,progress,reducedMotion,slides.length]);

  useEffect(()=>{
    if(!visible||!active||!foreground||slides.length<2)return;
    const timer=setTimeout(()=>goTo(index+1),payload?.settings.slideDwellMs??4000);
    return()=>clearTimeout(timer);
  },[active,foreground,goTo,index,payload?.settings.slideDwellMs,slides.length,visible]);

  useEffect(()=>{
    if(index>=slides.length)setIndex(0);
    if(visible&&slides.length===0)setVisible(false);
  },[index,slides.length,visible]);

  useEffect(()=>{
    const next=slides[(index+1)%Math.max(1,slides.length)];
    const url=next?safeProductImageUrl(next.imageKey):null;
    if(url)void Image.prefetch(url).catch(()=>undefined);
  },[index,slides]);

  const pan=useMemo(()=>PanResponder.create({
    onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)>10&&Math.abs(g.dx)>Math.abs(g.dy),
    onPanResponderRelease:(_,g)=>{
      if(g.dx<=-38)goTo(index+1);
      else if(g.dx>=38)goTo(index-1);
    },
    onPanResponderTerminationRequest:()=>true,
  }),[goTo,index]);
  const fail=(id:string)=>setFailed(old=>old.includes(id)?old:[...old,id]);
  const current=slides[index]??null;
  const previous=previousIndex===null?null:slides[previousIndex]??null;
  const incoming={transform:[{translateX:progress.interpolate({inputRange:[0,1],outputRange:[frameWidth,0]})}]};

  const image=(slide:HomePopupPayload["slides"][number])=>{
    const uri=safeProductImageUrl(slide.imageKey);if(!uri)return null;
    return <View style={{width:frameWidth,height:frameHeight}}>
      <Image source={{uri}} resizeMode="contain" style={StyleSheet.absoluteFillObject}
        accessibilityLabel={slide.altText} onError={()=>fail(slide.id)}/>
    </View>;
  };

  return <Modal visible={visible&&!!current} transparent animationType="fade"
    statusBarTranslucent onRequestClose={()=>setVisible(false)}>
    <View style={s.overlay} testID="home-promo-popup">
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button"
        accessibilityLabel="Đóng popup quảng bá" onPress={()=>setVisible(false)}/>
      <View style={[s.card,{width:frameWidth}]} testID="home-promo-card">
        <View testID="home-promo-frame"
          style={[s.frame,{width:frameWidth,height:frameHeight}]} {...pan.panHandlers}>
          {previous&&<View style={StyleSheet.absoluteFill}>{image(previous)}</View>}
          {current&&<Animated.View testID={"home-promo-slide-"+index} style={[StyleSheet.absoluteFill,incoming]}>{image(current)}</Animated.View>}
          <Pressable accessibilityRole="button" accessibilityLabel="Đóng popup"
            hitSlop={6} style={s.close} onPress={()=>setVisible(false)}>
            <Text style={s.closeText}>×</Text>
          </Pressable>
        </View>
        <View style={s.dots} testID="home-promo-dots">
          {slides.length>1&&slides.map((slide,dot)=><Pressable key={slide.id}
            accessibilityRole="tab" accessibilityLabel={"Ảnh popup "+(dot+1)}
            accessibilityState={{selected:dot===index}} style={s.dotTap}
            onPress={()=>goTo(dot)}>
            <View style={[s.dot,dot===index&&s.dotActive]}/>
          </Pressable>)}
        </View>
      </View>
    </View>
  </Modal>;
}

const s=StyleSheet.create({
  overlay:{flex:1,alignItems:"center",justifyContent:"center",padding:16,
    backgroundColor:"rgba(12,8,7,.68)"},
  card:{maxWidth:"100%",borderRadius:18,overflow:"hidden",backgroundColor:"transparent"},
  frame:{overflow:"hidden",backgroundColor:"transparent"},
  close:{position:"absolute",right:9,top:9,width:44,height:44,borderRadius:22,
    alignItems:"center",justifyContent:"center",backgroundColor:"rgba(0,0,0,.64)"},
  closeText:{color:"#FFFFFF",fontSize:28,lineHeight:32,fontWeight:"500"},
  dots:{height:42,flexDirection:"row",alignItems:"center",justifyContent:"center",
    backgroundColor:"transparent"},
  dotTap:{width:44,height:42,alignItems:"center",justifyContent:"center"},
  dot:{width:7,height:7,borderRadius:7,backgroundColor:"#D0D5DD"},
  dotActive:{width:18,backgroundColor:"#B42318"},
});
