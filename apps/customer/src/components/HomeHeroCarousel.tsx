import React,{useCallback,useEffect,useMemo,useRef,useState} from "react";
import { AccessibilityInfo,Animated,AppState,Image,PanResponder,Platform,Pressable,
  StyleSheet,Text,View,useWindowDimensions } from "react-native";
import { safeProductImageUrl,type HomeHeroPayload,type HomeHeroSlide } from "../api";
import { RecoverableImage } from "./RecoverableImage";

export function HomeHeroCarousel({payload,loading,error,active,onRetry,onMenu}:{
  payload:HomeHeroPayload|null;loading:boolean;error:string;active:boolean;
  onRetry:()=>void;onMenu:()=>void;
}){
  const {width:viewportWidth}=useWindowDimensions();
  const heroWidth=Math.max(280,Math.min(viewportWidth,620)-24);
  const heroHeight=heroWidth*321/829;
  const heroScale=heroWidth/829;
  const signature=(payload?.slides??[]).map(s=>s.id+":"+s.imageKey).join("|");
  const [index,setIndex]=useState(0);
  const [previousIndex,setPreviousIndex]=useState<number|null>(null);
  const [visible,setVisible]=useState(true);
  const [reducedMotion,setReducedMotion]=useState(false);
  const [timerEpoch,setTimerEpoch]=useState(0);
  const progress=useRef(new Animated.Value(1)).current;
  const transitionLock=useRef(false);

  useEffect(()=>{setIndex(0);setPreviousIndex(null);progress.setValue(1);},[signature,progress]);
  useEffect(()=>{
    let mounted=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(mounted)setReducedMotion(value);});
    const sub=AccessibilityInfo.addEventListener("reduceMotionChanged",setReducedMotion);
    return()=>{mounted=false;sub.remove();};
  },[]);
  useEffect(()=>{
    const update=()=>{
      const next=Platform.OS==="web"
        ?typeof document==="undefined"||document.visibilityState==="visible"
        :AppState.currentState==="active";
      setVisible(next);
    };
    update();
    const app=AppState.addEventListener("change",update);
    if(Platform.OS==="web"&&typeof document!=="undefined")
      document.addEventListener("visibilitychange",update);
    return()=>{app.remove();if(Platform.OS==="web"&&typeof document!=="undefined")
      document.removeEventListener("visibilitychange",update);};
  },[]);

  const slides=useMemo(()=>(payload?.slides??[]).filter(slide=>
    !!safeProductImageUrl(slide.imageKey)),[payload]);
  const settings=payload?.settings??{
    autoplay:true,dwellMs:5000,transitionType:"fade" as const,transitionDurationMs:450,
    revision:0,updatedAt:null,
  };
  useEffect(()=>{if(index>=slides.length)setIndex(0);},[index,slides.length]);

  const goTo=useCallback((target:number,user=false)=>{
    if(slides.length<2||transitionLock.current)return;
    const normalized=(target+slides.length)%slides.length;
    if(normalized===index)return;
    const duration=reducedMotion?0:settings.transitionDurationMs;
    transitionLock.current=true;setPreviousIndex(index);setIndex(normalized);progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress,{toValue:1,duration,useNativeDriver:false}).start(()=>{
      setPreviousIndex(null);transitionLock.current=false;
    });
    if(user)setTimerEpoch(value=>value+1);
  },[index,progress,reducedMotion,settings.transitionDurationMs,slides.length]);

  useEffect(()=>{
    if(!active||!visible||!settings.autoplay||slides.length<2)return;
    // Schedule the next dwell whenever the visible index changes. Do not gate
    // scheduling on transitionLock: index changes while the animation lock is
    // still true, so that gate permanently stopped autoplay after slide #2.
    const timer=setTimeout(()=>goTo(index+1),settings.dwellMs);
    return()=>clearTimeout(timer);
  },[active,goTo,index,settings.autoplay,settings.dwellMs,slides.length,timerEpoch,visible]);

  useEffect(()=>{
    if(slides.length<2)return;
    const next=slides[(index+1)%slides.length];
    const url=next?safeProductImageUrl(next.imageKey):null;
    if(url)void Image.prefetch(url).catch(()=>undefined);
  },[index,slides]);

  const pan=useMemo(()=>PanResponder.create({
    onMoveShouldSetPanResponder:(_,gesture)=>Math.abs(gesture.dx)>10&&Math.abs(gesture.dx)>Math.abs(gesture.dy),
    onPanResponderRelease:(_,gesture)=>{
      if(gesture.dx<=-38)goTo(index+1,true);
      else if(gesture.dx>=38)goTo(index-1,true);
    },
    onPanResponderTerminationRequest:()=>true,
  }),[goTo,index]);

  const renderContent=(slide:HomeHeroSlide)=>{
    const uri=safeProductImageUrl(slide.imageKey);
    if(!uri)return null;
    return <View style={[s.slide,{width:heroWidth,height:heroHeight}]}>
      <RecoverableImage uri={uri} resizeMode="cover"
        style={StyleSheet.absoluteFillObject} accessibilityLabel={slide.altText}/>
      {(slide.title||slide.subtitle||slide.ctaTarget)&&<View style={s.copy}>
        {!!slide.title&&<Text style={s.title} numberOfLines={2}>{slide.title}</Text>}
        {!!slide.subtitle&&<Text style={s.subtitle} numberOfLines={2}>{slide.subtitle}</Text>}
        {slide.ctaTarget==="MENU"&&<Pressable accessibilityRole="button"
          accessibilityLabel="Xem thực đơn từ banner" style={s.cta} onPress={onMenu}>
          <Text style={s.ctaText}>Xem thực đơn</Text>
        </Pressable>}
      </View>}
    </View>;
  };
  const current=slides[index]??null;
  const previous=previousIndex===null?null:slides[previousIndex]??null;
  const transition=settings.transitionType;
  const incoming=transition==="fade"?{opacity:progress}
    :transition==="slide"?{transform:[{translateX:progress.interpolate({
      inputRange:[0,1],outputRange:[heroWidth,0]})}]}:{};
  const wipeWidth=progress.interpolate({inputRange:[0,1],outputRange:[0,heroWidth]});

  const fallback=<View style={[s.frame,{width:heroWidth,height:heroHeight}]}>
    <Image source={require("../../assets/home-reference.png")} resizeMode="stretch"
      accessibilityLabel="Ảnh banner dự phòng theo mẫu đã duyệt"
      style={[s.fallbackImage,{left:-58*heroScale,top:-232*heroScale,
        width:941*heroScale,height:1672*heroScale}]}/>
    {(loading||error)&&<View style={s.status}>
      <Text style={s.statusText}>{loading&&!error?"Đang tải banner…":
        error?"Banner đang dùng ảnh dự phòng.":"Chưa có banner được bật."}</Text>
      {!!error&&<Pressable accessibilityRole="button"
        accessibilityLabel="Tải lại banner" style={s.retry} onPress={()=>{
          setTimerEpoch(x=>x+1);onRetry();
        }}><Text style={s.retryText}>Thử lại</Text></Pressable>}
    </View>}
  </View>;

  if(!current)return <View style={s.wrap}>{fallback}</View>;
  return <View style={s.wrap}>
    <View style={[s.frame,{width:heroWidth,height:heroHeight}]} {...pan.panHandlers}
      testID="home-live-hero" accessibilityLabel={"Banner "+(index+1)+" trên "+slides.length}>
      {previous&&<View style={StyleSheet.absoluteFill}>{renderContent(previous)}</View>}
      {transition==="wipe"&&previous
        ?<Animated.View style={[s.wipe,{width:wipeWidth,height:heroHeight}]}>
          <View style={{width:heroWidth,height:heroHeight}}>{renderContent(current)}</View>
        </Animated.View>
        :<Animated.View style={[StyleSheet.absoluteFill,incoming]}>{renderContent(current)}</Animated.View>}
      {slides.length>1&&<View style={s.dotsOverlay} accessibilityRole="tablist">
        {slides.map((slide,dot)=><Pressable key={slide.id} accessibilityRole="tab"
          accessibilityLabel={"Banner "+(dot+1)} accessibilityState={{selected:dot===index}}
          onPress={()=>goTo(dot,true)} style={s.dotTap}>
          <View style={[s.dot,dot===index&&s.dotActive]}/>
        </Pressable>)}
      </View>}
    </View>
  </View>;
}
const s=StyleSheet.create({
  wrap:{alignItems:"center"},frame:{overflow:"hidden",borderRadius:18,backgroundColor:"#6D1710"},
  slide:{position:"relative",overflow:"hidden"},wipe:{position:"absolute",left:0,top:0,overflow:"hidden"},
  fallbackImage:{position:"absolute"},copy:{position:"absolute",left:0,right:0,bottom:0,
    paddingHorizontal:16,paddingTop:28,paddingBottom:46,gap:4,
    backgroundColor:"rgba(43,4,2,0.52)"},
  title:{color:"#FFF8EA",fontSize:20,lineHeight:24,fontWeight:"900",maxWidth:"86%"},
  subtitle:{color:"#FFF8EA",fontSize:12,lineHeight:17,fontWeight:"600",maxWidth:"88%"},
  cta:{minHeight:44,alignSelf:"flex-start",justifyContent:"center",marginTop:4,
    paddingHorizontal:16,borderRadius:22,backgroundColor:"#FFF0D3"},
  ctaText:{fontSize:13,fontWeight:"900",color:"#A31E1B"},
  dotsOverlay:{position:"absolute",left:0,right:0,bottom:0,height:44,
    flexDirection:"row",alignItems:"center",justifyContent:"center"},
  dotTap:{width:44,height:44,alignItems:"center",justifyContent:"center"},
  dot:{width:7,height:7,borderRadius:7,backgroundColor:"rgba(255,255,255,.62)"},
  dotActive:{width:18,backgroundColor:"#FFFFFF"},
  status:{position:"absolute",left:9,right:9,bottom:9,minHeight:44,borderRadius:10,
    backgroundColor:"rgba(32,8,7,.78)",paddingHorizontal:10,flexDirection:"row",
    gap:8,alignItems:"center",justifyContent:"space-between"},
  statusText:{flex:1,color:"#FFFFFF",fontSize:11,lineHeight:15,fontWeight:"700"},
  retry:{minHeight:44,minWidth:58,alignItems:"center",justifyContent:"center"},
  retryText:{color:"#FFE5B9",fontSize:12,fontWeight:"900"},
});
