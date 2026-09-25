<script lang="ts">
  import Toast from "./components/Toast.svelte";
  import Detail from "./pages/Detail.svelte";
  import Home from "./pages/Home.svelte";
  import { router } from "./lib/router.svelte";

  function goHome(e: MouseEvent) {
    e.preventDefault();
    router.go({ name: "home" });
  }
</script>

<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href={router.href({ name: "home" })} onclick={goHome}>Query</a>
  </div>
</header>

<main class="container">
  {#if router.route.name === "detail"}
    {#key router.route.id}
      <Detail id={router.route.id} />
    {/key}
  {:else}
    <Home />
  {/if}
</main>

<Toast />
