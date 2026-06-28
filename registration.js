import { supabase } from "./supabase.js";

const DEFAULT_PROFILE = "./images/user.png";

window.validateForm = async function () {
  const fullname = document.getElementById("fullname").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const password = document.getElementById("password").value.trim();
  const confirmPassword = document.getElementById("confirmPassword").value.trim();

  if (fullname === "") {
    alert("Please enter your full name.");
    return;
  }

  if (email === "") {
    alert("Please enter your email.");
    return;
  }

  if (!email.includes("@")) {
    alert("Please enter valid email.");
    return;
  }

  if (phone === "") {
    alert("Please enter your phone number.");
    return;
  }

  if (password.length < 8) {
    alert("Password must be at least 8 characters.");
    return;
  }

  if (password !== confirmPassword) {
    alert("Passwords do not match.");
    return;
  }

  try {
    await supabase.auth.signOut();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name: fullname },
      },
    });

    if (error) throw error;

    const userId = data?.user?.id;
    if (userId) {
      await supabase.from("profiles").update({ phone }).eq("id", userId);
      localStorage.setItem("customerPhone", phone);
    }

    await supabase.auth.signOut();

    alert("Registration successful! Please log in with your new account.");
    window.location.href = "login.html";
  } catch (error) {
    console.log(error);

    if (error.message?.includes("already registered") || error.message?.includes("already exists")) {
      alert("Email already registered.");
    } else {
      alert(error.message);
    }
  }
};

window.showPass = function () {
  const password = document.getElementById("password");
  const confirmPassword = document.getElementById("confirmPassword");

  if (password.type === "password") {
    password.type = "text";
    confirmPassword.type = "text";
  } else {
    password.type = "password";
    confirmPassword.type = "password";
  }
};

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    await validateForm();
  });
}
