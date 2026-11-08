import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/create" },
    { path: "/login", component: () => import("@/pages/loginPage.vue"), meta: { public: true } },
    { path: "/create", component: () => import("@/pages/createPage.vue") },
    { path: "/canvas", redirect: "/canvas/canvas-1" },
    { path: "/canvas/:id", component: () => import("@/pages/canvasPage.vue"), meta: { chrome: false } },
    { path: "/projects", component: () => import("@/pages/projectsPage.vue") },
    { path: "/projects/:id", component: () => import("@/pages/projectDetailPage.vue") },
    { path: "/studio/image", component: () => import("@/pages/imageStudioPage.vue") },
    { path: "/studio/video", component: () => import("@/pages/videoStudioPage.vue") },
    { path: "/assets", component: () => import("@/pages/assetsPage.vue") },
    { path: "/skills", component: () => import("@/pages/skillsPage.vue") },
    { path: "/plugins", component: () => import("@/pages/pluginsPage.vue") },
    { path: "/tasks", component: () => import("@/pages/tasksPage.vue") },
    { path: "/settings", component: () => import("@/pages/settingsPage.vue") },
  ],
});
