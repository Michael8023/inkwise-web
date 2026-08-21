// 底部四 Tab：文献库 / 速览 / AI 研究 / 我的（对照原型 bottomnav）
import { Tabs } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES, Layout } from "@/theme/tokens";

export default function TabsLayout() {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.text3,
        tabBarStyle: {
          backgroundColor: t.paper,
          borderTopColor: t.border,
          borderTopWidth: 0.5,
          height: Layout.tabBarHeight,
          paddingBottom: 6,
          paddingTop: 4,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: "500" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "文献",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="library-books" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="skim"
        options={{
          title: "速览",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="bolt" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          title: "AI 研究",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="forum" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "我的",
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
