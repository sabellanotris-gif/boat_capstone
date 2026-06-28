import { supabase } from "./supabase.js";

window.login = async function () {
  let email = document.getElementById("email").value.trim();
  let password = document.getElementById("password").value.trim();

  if (email === "" || password === "") {
    alert("Please fill all fields.");
    return;
  }

  if (!email.includes("@")) {
    alert("Please enter a valid email address.");
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    alert(error.message);
    console.log(error);
    return;
  }

  const user = data.user;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, photo, role, phone")
    .eq("id", user.id)
    .single();

  localStorage.setItem("customerName", profile?.name || user.email.split('@')[0] || user.email);
  localStorage.setItem("customerEmail", user.email);
  localStorage.setItem("userId", user.id);
  localStorage.setItem("customerImage", profile?.photo || "./images/user.png");
  localStorage.setItem("customerPhone", profile?.phone || "");

  const isAdmin = profile?.role === "admin";

  if (isAdmin) {
    alert("Welcome Admin!");
    localStorage.setItem("role", "admin");
    window.location.href = "dashboard.html";
  } else {
    alert("Login Successful!");
    localStorage.setItem("role", "user");
    window.location.href = "home.html";
  }
};



window.googleLogin = async function () {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/login.html",
    },
  });

  if (error) {
    console.log(error);
    alert(error.message);
  }
};

document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  login();
});

window.showPass = function () {
  let pass = document.getElementById("password");
  if (pass.type === "password") {
    pass.type = "text";
  } else {
    pass.type = "password";
  }
};

(async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;

  const user = data.session.user;
  const email = user.email;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, photo, role, phone")
    .eq("id", user.id)
    .single();

  // Ensure a profile exists (create one if missing — common for OAuth)
  if (!profile) {
    await supabase.from("profiles").upsert({
      id: user.id,
      email: email,
      name: user.user_metadata?.full_name || email.split('@')[0] || email,
      photo: user.user_metadata?.avatar_url || "./images/user.png",
      role: "user"
    }, { onConflict: "id" });
    const { data: newProfile } = await supabase
      .from("profiles")
      .select("name, photo, role, phone")
      .eq("id", user.id)
      .single();
    profile = newProfile;
  }

  localStorage.setItem("customerName", profile?.name || user.user_metadata?.full_name || email.split('@')[0] || email);
  localStorage.setItem("customerEmail", email);
  localStorage.setItem("userId", user.id);
  localStorage.setItem("customerImage", profile?.photo || user.user_metadata?.avatar_url || "./images/user.png");
  localStorage.setItem("customerPhone", profile?.phone || "");

  const isAdmin = profile?.role === "admin";

  if (isAdmin) {
    localStorage.setItem("role", "admin");
    window.location.href = "dashboard.html";
  } else {
    localStorage.setItem("role", "user");
    window.location.href = "home.html";
  }
})();
