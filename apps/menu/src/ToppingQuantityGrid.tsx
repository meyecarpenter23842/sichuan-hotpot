import React from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { Option } from "./menu-api";
import { money, productImage } from "./menu-api";
import { optionQuantity } from "./menu-cart";

const dark = "#332322", red = "#902C34", border = "#E7DDD7";
export function ToppingQuantityGrid({ options, selected, max, onQuantity }: {
  options: Option[]; selected: string[]; max: number;
  onQuantity: (id: string, quantity: number) => void;
}) {
  const { width } = useWindowDimensions();
  return <View style={s.grid}>
    {options.filter(o => o.isAvailable).map(o => {
      const count = optionQuantity(selected, o.id);
      const image = productImage(o.imageKey);
      const full = selected.length >= max;
      return <View key={o.id} style={[s.card, width < 500 && s.mobileCard, count > 0 && s.active]} testID={"modifier-"+o.id}>
        {image ? <Image source={{ uri: image }} resizeMode="cover" style={s.photo}/> :
          <View style={s.placeholder}><Text style={s.photoHint}>🥬</Text></View>}
        <View style={s.info}>
          <Text numberOfLines={2} style={s.name}>{o.name}</Text>
          <Text style={s.price}>{o.priceDeltaVnd ? "+"+money(o.priceDeltaVnd) : "Không phụ thu"}</Text>
          <View style={s.counter}>
            <Pressable accessibilityRole="button" accessibilityLabel={"Giảm "+o.name}
              accessibilityState={{ disabled: count===0 }} disabled={count===0}
              onPress={() => onQuantity(o.id, count-1)} style={[s.step,count===0&&s.off]}>
              <Text style={s.symbol}>−</Text>
            </Pressable>
            <Text style={s.quantity} accessibilityLabel={o.name+": "+count}>{count}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={"Tăng "+o.name}
              accessibilityState={{ disabled: full }} disabled={full}
              onPress={() => onQuantity(o.id, count+1)} style={[s.step,full&&s.off]}>
              <Text style={s.symbol}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>;
    })}
  </View>;
}
const s=StyleSheet.create({
  grid:{flexDirection:"row",flexWrap:"wrap",gap:9},
  card:{width:"48%",minWidth:0,flexDirection:"row",gap:8,padding:7,
    backgroundColor:"#FFFFFF",borderWidth:1,borderColor:border,borderRadius:11},
  active:{borderColor:red,backgroundColor:"#FFF6F5"},
  mobileCard:{width:"100%"},
  photo:{width:62,height:70,borderRadius:8,backgroundColor:"#F4ECE5"},
  placeholder:{width:62,height:70,borderRadius:8,backgroundColor:"#F4ECE5",
    alignItems:"center",justifyContent:"center"},
  photoHint:{fontSize:23},
  info:{flex:1,minWidth:0,gap:3},
  name:{fontSize:12,fontWeight:"800",color:dark},
  price:{fontSize:11,fontWeight:"800",color:red},
  counter:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:2},
  step:{minWidth:36,minHeight:44,alignItems:"center",justifyContent:"center",
    backgroundColor:"#F5ECE6",borderRadius:8},
  off:{opacity:.38},
  symbol:{fontSize:18,fontWeight:"800",color:red},
  quantity:{minWidth:17,textAlign:"center",fontSize:14,fontWeight:"900",color:dark},
});
